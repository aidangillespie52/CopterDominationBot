// ==UserScript==
// @name         PIXI v4 Stage Logger (postrender + texture preview + source URL)
// @namespace    aidan.pixi.tools
// @version      1.5.0
// @description  Log after each frame so stage/root is available + preview rendered textures + show texture file/frame
// @match        *://*/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  'use strict';

  const THROTTLE_FRAMES = 15; // log every N frames

  // -------- API sender ----------
  const API_URL = "https://api.yourdomain.com/pixi-ingest";
  const API_TOKEN = ""; // optional: "Bearer xxx" style below
  const SEND_EVERY_MS = 2000; // minimum time between sends
  const MAX_QUEUE = 5;        // drop older frames if we get behind

  let __lastSendAt = 0;
  let __sendInFlight = false;
  let __queue = [];

  function enqueueSend(payload) {
    __queue.push(payload);
    if (__queue.length > MAX_QUEUE) __queue.shift(); // drop oldest
    flushQueue();
  }

  function flushQueue() {
    console.log("flushQueue called")
    if (__sendInFlight) return;

    const now = Date.now();
    if (now - __lastSendAt < SEND_EVERY_MS) return;

    const next = __queue.pop(); // keep most recent
    __queue.length = 0;

    __sendInFlight = true;
    __lastSendAt = now;

    console.log("before request attempt")
    try {
      GM_xmlhttpRequest({
        method: "POST",
        url: API_URL,
        headers: {
          "Content-Type": "application/json",
          ...(API_TOKEN ? { "Authorization": `Bearer ${API_TOKEN}` } : {})
        },
        data: JSON.stringify(next),
        timeout: 15000,
        onload: (res) => {
          __sendInFlight = false;
          // optional debug:
          console.log("[PIXI API] sent", res.status);
          flushQueue(); // send again if queued
        },
        onerror: () => { __sendInFlight = false; },
        ontimeout: () => { __sendInFlight = false; }
      });
    } catch (e) {
      console.log(`request attempt failed ${e}`)
      __sendInFlight = false;
    }
  }

  // -------- texture preview helpers ----------
  function getExtract(renderer){
    return renderer && (renderer.extract || renderer.plugins?.extract) || null;
  }

  function toCanvas(obj, renderer){
    const extract = getExtract(renderer);
    if (extract && typeof extract.canvas === 'function') {
      // Exact on-screen pixels of the object (includes crop/trim/UV/tint)
      return extract.canvas(obj);
    }
    if (renderer && typeof renderer.generateTexture === 'function') {
      const tex = renderer.generateTexture(obj);
      const src = tex.baseTexture && tex.baseTexture.source;
      if (src instanceof HTMLCanvasElement) return src;
      if (src && (src instanceof HTMLImageElement || src instanceof HTMLVideoElement)) {
        const c = document.createElement('canvas');
        c.width  = tex.frame.width; c.height = tex.frame.height;
        const g = c.getContext('2d');
        g.drawImage(src, tex.frame.x, tex.frame.y, tex.frame.width, tex.frame.height, 0, 0, c.width, c.height);
        return c;
      }
    }
    return null;
  }

  function showCanvasOverlay(canvas, title='Texture Preview'){
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position:'fixed', right:'12px', bottom:'12px', zIndex: 2147483647,
      background:'#111', padding:'8px 8px 6px', border:'1px solid #444', borderRadius:'8px',
      boxShadow: '0 6px 18px rgba(0,0,0,.35)', color:'#ddd', font:'12px/1.4 system-ui, sans-serif'
    });
    const head = document.createElement('div');
    head.textContent = title;
    head.style.margin = '0 0 6px';
    head.style.opacity = '0.8';
    const close = document.createElement('button');
    close.textContent = '×';
    Object.assign(close.style, {
      position:'absolute', top:'-10px', right:'-10px', width:'24px', height:'24px',
      borderRadius:'50%', border:'none', cursor:'pointer', lineHeight:'24px'
    });
    close.onclick = ()=> wrap.remove();
    canvas.style.maxWidth = '360px';
    canvas.style.maxHeight = '260px';
    wrap.appendChild(head);
    wrap.appendChild(canvas);
    wrap.appendChild(close);
    document.body.appendChild(wrap);
  }

  function findRendererGuess(){
    const P = window.PIXI;
    const cand = window.app?.renderer || window.renderer || P?.renderer || null;
    if (cand) return cand;
    // brute-force globals
    for (const k in window) {
      const v = window[k];
      if (v && typeof v === 'object' && typeof v.render === 'function') {
        const n = v.constructor?.name;
        if (n === 'WebGLRenderer' || n === 'CanvasRenderer') return v;
      }
    }
    return null;
  }

  // Public API
  window.PIXI_TEX = function(obj, rendererGuess){
    try{
      const r = rendererGuess || findRendererGuess();
      if (!r || !obj) { console.warn('[PIXI_TEX] need object and renderer'); return; }
      const c = toCanvas(obj, r);
      if (!c) { console.warn('[PIXI_TEX] could not extract canvas'); return; }
      const name = obj.name || obj.constructor?.name || 'DisplayObject';
      showCanvasOverlay(c, `Texture: ${name}`);
      console.info('[PIXI_TEX] frame/orig/trim:', obj.texture?.frame, obj.texture?.orig, obj.texture?.trim);
    }catch(e){ console.warn('[PIXI_TEX]', e); }
  };

  window.PIXI_TEX_AT = function(x, y, rendererGuess){
    const P = window.PIXI;
    const r = rendererGuess || findRendererGuess();
    if (!P || !r) { console.warn('[PIXI_TEX_AT] Need PIXI and renderer'); return; }
    const im = r.interaction || r.plugins?.interaction;
    const stage = r._lastObjectRendered || r.stage || window.app?.stage;
    if (!im || !stage) { console.warn('[PIXI_TEX_AT] No interaction or stage'); return; }
    const pt = new P.Point(x, y);
    const target = typeof im.hitTest === 'function' ? im.hitTest(pt, stage) : null;
    if (!target) { console.warn('[PIXI_TEX_AT] Nothing under point'); return; }
    window.PIXI_TEX(target, r);
  };

  // Optional: press Shift+T to preview under mouse
  window.addEventListener('keydown', (e)=>{
    if (e.key.toLowerCase() === 't' && e.shiftKey) {
      const r = findRendererGuess();
      if (!r || !r.view) return;
      const rect = r.view.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (r.width / rect.width);
      const y = (e.clientY - rect.top)  * (r.height / rect.height);
      window.PIXI_TEX_AT(x, y, r);
    }
  }, true);

  // -------- provenance helpers (NEW) ----------
  function getTextureFromDisplayObject(o){
    if (o && o.texture) return o.texture;     // Sprite, Mesh, Text (as texture), etc.
    if (o && o._texture) return o._texture;   // safety
    return null;
  }

  function resolveBaseURLFromBaseTexture(bt){
    if (!bt) return null;
    if (bt.imageUrl) return bt.imageUrl;       // common in v4
    const src = bt.source;
    if (src) {
      if (src.currentSrc) return src.currentSrc;
      if (src.src) return src.src;
    }
    if (bt.resource && bt.resource.url) return bt.resource.url;
    return null;
  }

  function reverseLookupTextureCacheKey(tex){
    const ids = tex.textureCacheIds || tex._textureCacheIds;
    if (ids && ids.length) return ids[0];
    const cache = window.PIXI?.utils?.TextureCache;
    if (cache) {
      for (const k in cache) if (cache[k] === tex) return k;
    }
    return null;
  }

  function findLoaderResourceForBaseTexture(bt){
    const L =
      (window.PIXI?.loaders && window.PIXI.loaders.shared) ||
      window.PIXI?.loader ||
      (window.PIXI?.loaders && window.PIXI.loaders.Loader && window.PIXI.loaders.Loader.shared);
    const resources = L && L.resources;
    if (!resources) return null;

    for (const name in resources){
      const r = resources[name];
      // direct image
      if (r.texture && r.texture.baseTexture === bt) {
        return { resName: name, url: r.url, atlas: false, frameKey: null };
      }
      // spritesheet / atlas
      if (r.textures){
        for (const fk in r.textures){
          const tex = r.textures[fk];
          if (tex && tex.baseTexture === bt) {
            return { resName: name, url: r.url, atlas: true, frameKey: fk };
          }
        }
      }
    }
    return null;
  }

  function textureInfo(o){
    const tex = getTextureFromDisplayObject(o);
    if (!tex) return null;
    const bt = tex.baseTexture || tex._baseTexture;
    const baseURL = resolveBaseURLFromBaseTexture(bt);
    const res = findLoaderResourceForBaseTexture(bt);
    const frameKey = (res && res.frameKey) || reverseLookupTextureCacheKey(tex);
    const frame = tex.frame || null;
    const w = frame ? frame.width  : (bt ? bt.width  : undefined);
    const h = frame ? frame.height : (bt ? bt.height : undefined);

    return {
      texURL: (res && res.url) || baseURL || null, // file/atlas url if known
      resName: res ? res.resName : null,           // loader key
      frameKey: frameKey,                           // frame name or cache id
      atlas: !!(res && res.atlas),                  // spritesheet?
      size: (w!=null && h!=null) ? `${w}×${h}` : null,
      baseUid: bt && bt.uid,
      frame, orig: tex.orig || null, trim: tex.trim || null
    };
  }

  // -------- your original logger ----------
  function collectRenderList(root) {
    const out = [];
    (function walk(o){
      if (!o || !o.visible || (o.worldAlpha!==undefined && o.worldAlpha<=0)) return;
      if (o.renderable) out.push(o);
      const ch = o.children; if (ch) for (let i=0;i<ch.length;i++) walk(ch[i]);
    })(root);
    return out;
  }

  function describeWithTexture(o){
    const wt = o.worldTransform;
    const x = wt ? wt.tx : (o.position && o.position.x);
    const y = wt ? wt.ty : (o.position && o.position.y);
    const type = (o.constructor && o.constructor.name) || 'DisplayObject';
    const base = {
      type,
      name: o.name || (o.text?String(o.text).slice(0,24):''),
      x: Math.round(x||0), y: Math.round(y||0),
      alpha: +( (o.worldAlpha==null?1:o.worldAlpha).toFixed ? o.worldAlpha.toFixed(3) : o.worldAlpha ),
      visible: o.visible, renderable: o.renderable,
      children: o.children?o.children.length:0
    };
    const ti = textureInfo(o);
    if (!ti) return base; // e.g., Graphics/Container
    return Object.assign(base, {
        texURL: ti.texURL,
        resName: ti.resName,
        frameKey: ti.frameKey,
        atlas: ti.atlas,
        size: ti.size,
        baseUid: ti.baseUid,

        // NEW: atlas pixel rect
        frameX: ti.frame ? ti.frame.x : null,
        frameY: ti.frame ? ti.frame.y : null,
        frameW: ti.frame ? ti.frame.width : null,
        frameH: ti.frame ? ti.frame.height : null,

        // (optional) useful when trimmed
        origW: ti.orig ? ti.orig.width : null,
        origH: ti.orig ? ti.orig.height : null,
        trimX: ti.trim ? ti.trim.x : null,
        trimY: ti.trim ? ti.trim.y : null,
        trimW: ti.trim ? ti.trim.width : null,
        trimH: ti.trim ? ti.trim.height : null,
    });

  }

  // handy console helpers
  window.PIXI_TEX_INFO = function(i){
    const o = window.__PIXILOG_LIST && window.__PIXILOG_LIST[i];
    if (!o) return console.warn('No object at index', i);
    console.info('[TEX_INFO]', describeWithTexture(o), o);
  };
  window.PIXI_TEX_URL = function(i){
    const o = window.__PIXILOG_LIST && window.__PIXILOG_LIST[i];
    if (!o) return console.warn('No object at index', i);
    const ti = textureInfo(o);
    if (!ti || !ti.texURL) return console.warn('No URL for this object');
    console.log(ti.texURL);
  };

  function patch(RendererCtor){
    if (!RendererCtor || RendererCtor.prototype.__pixi4LoggerPatched) return;
    const orig = RendererCtor.prototype.render;
    if (typeof orig !== 'function') return;

    RendererCtor.prototype.render = function patched(root){
      // Ensure postrender hook once
      if (!this.__pixi4LoggerHooked && typeof this.on === 'function') {
        let frame = 0;
        this.on('postrender', () => {
          if ((frame++ % THROTTLE_FRAMES) !== 0) return; // throttle
          try {
            const stage = this._lastObjectRendered || root || this.root || this.stage;
            if (!stage) return;
            const list = collectRenderList(stage);
            console.groupCollapsed('%cPIXI v4 — Render List (postrender)', 'color:#00a2ff;font-weight:bold');
            console.log('Renderer:', this);
            console.log('Stage:', stage);
            console.log('Renderables:', list.length);
            // Store globally so we can reference the display objects later
            window.__PIXILOG_LIST = list;

            // Build rows with provenance + quick commands
            const rows = list.map((o, i) => {
              const d = describeWithTexture(o);
              d.preview = `PIXI_TEX(__PIXILOG_LIST[${i}])`;
              d.info    = `PIXI_TEX_INFO(${i})`;
              d.url     = `PIXI_TEX_URL(${i})`;
              return d;
            });

            console.table(rows);
            console.groupEnd();
            
            console.log("sending data")

            enqueueSend({
              ts: Date.now(),
              page: location.href,
              pixiVersion: window.PIXI?.VERSION || null,
              rendererType: this?.constructor?.name || null,
              renderables: rows
            });

          } catch (e) {
            // swallow to avoid breaking host app
          }
        });
        this.__pixi4LoggerHooked = true;
      }

      const ret = orig.apply(this, arguments); // draw first
      return ret;
    };

    RendererCtor.prototype.__pixi4LoggerPatched = true;
    console.info('[PIXI4-LOGGER] Patched render on', RendererCtor.name || 'Renderer');
  }

  function tryPatch(){
    const P = window.PIXI; if (!P) return false;
    // Only v4
    if (!/^4(\.|$)/.test((P.VERSION||'').trim())) return false;
    patch(P.WebGLRenderer); patch(P.CanvasRenderer);
    return true;
  }

  if (!tryPatch()){
    const iv = setInterval(() => { if (tryPatch()) clearInterval(iv); }, 100);
    setTimeout(() => clearInterval(iv), 120000); // extend retry to 2 min
  }
})();
