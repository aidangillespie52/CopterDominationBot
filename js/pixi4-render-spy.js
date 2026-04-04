(function () {
  'use strict';

  const THROTTLE_FRAMES = 15;
  const API_URL = "http://localhost:5000/pixi-ingest"; // your local Python server
  const SEND_EVERY_MS = 50;
  const MAX_QUEUE = 5;

  let __lastSendAt = 0;
  let __sendInFlight = false;
  let __queue = [];

  function enqueueSend(payload) {
    __queue.push(payload);
    if (__queue.length > MAX_QUEUE) __queue.shift();
    flushQueue();
  }

  function flushQueue() {
    if (__sendInFlight) return;
    const now = Date.now();
    if (now - __lastSendAt < SEND_EVERY_MS) return;
    const next = __queue.pop();
    __queue.length = 0;
    __sendInFlight = true;
    __lastSendAt = now;

    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next)
    })
    .then(() => { __sendInFlight = false; flushQueue(); })
    .catch(() => { __sendInFlight = false; });
  }

  // --- texture info ---
  function getTextureFromDisplayObject(o) {
    return o?.texture || o?._texture || null;
  }

  function resolveBaseURL(bt) {
    if (!bt) return null;
    if (bt.imageUrl) return bt.imageUrl;
    const src = bt.source;
    if (src?.currentSrc) return src.currentSrc;
    if (src?.src) return src.src;
    return bt.resource?.url || null;
  }

  function getFrameKey(tex) {
    const ids = tex.textureCacheIds || tex._textureCacheIds;
    if (ids?.length) return ids[0];
    const cache = window.PIXI?.utils?.TextureCache;
    if (cache) for (const k in cache) if (cache[k] === tex) return k;
    return null;
  }

  function describeObject(o) {
    const wt = o.worldTransform;
    const tex = getTextureFromDisplayObject(o);
    const bt = tex?.baseTexture || tex?._baseTexture;
    const frame = tex?.frame || null;

    return {
      type: o.constructor?.name || 'DisplayObject',
      name: o.name || (o.text ? String(o.text).slice(0, 24) : ''),
      x: Math.round(wt?.tx || o.position?.x || 0),
      y: Math.round(wt?.ty || o.position?.y || 0),
      alpha: parseFloat((o.worldAlpha ?? 1).toFixed(3)),
      texURL: resolveBaseURL(bt),
      frameKey: tex ? getFrameKey(tex) : null,
      frameX: frame?.x ?? null,
      frameY: frame?.y ?? null,
      frameW: frame?.width ?? null,
      frameH: frame?.height ?? null,
    };
  }

  function collectRenderList(root) {
    const out = [];
    (function walk(o) {
      if (!o || !o.visible || (o.worldAlpha !== undefined && o.worldAlpha <= 0)) return;
      if (o.renderable) out.push(o);
      if (o.children) o.children.forEach(walk);
    })(root);
    return out;
  }

  function patch(RendererCtor) {
    if (!RendererCtor || RendererCtor.prototype.__pixiPatched) return;
    const orig = RendererCtor.prototype.render;
    if (typeof orig !== 'function') return;

    RendererCtor.prototype.render = function (root) {
      if (!this.__pixiHooked && typeof this.on === 'function') {
        let frame = 0;
        this.on('postrender', () => {
          if ((frame++ % THROTTLE_FRAMES) !== 0) return;
          try {
            const stage = this._lastObjectRendered || root || this.stage;
            if (!stage) return;
            const renderables = collectRenderList(stage).map(describeObject);
            window.__PIXILOG_LIST = renderables;
            enqueueSend({
              ts: Date.now(),
              page: location.href,
              pixiVersion: window.PIXI?.VERSION || null,
              renderables
            });
          } catch (_) {}
        });
        this.__pixiHooked = true;
      }
      return orig.apply(this, arguments);
    };

    RendererCtor.prototype.__pixiPatched = true;
  }

  function tryPatch() {
    const P = window.PIXI;
    if (!P || !/^4(\.|$)/.test((P.VERSION || '').trim())) return false;
    patch(P.WebGLRenderer);
    patch(P.CanvasRenderer);
    return true;
  }

  if (!tryPatch()) {
    const iv = setInterval(() => { if (tryPatch()) clearInterval(iv); }, 100);
    setTimeout(() => clearInterval(iv), 120000);
  }
})();