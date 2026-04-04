import threading
import uvicorn
import csv
from seleniumbase import Driver
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from logger import setup_logger

logger = setup_logger(__name__)
# --- Load frames lookup ---
FRAMES_FILEPATH = Path("data") / "frames.csv"

def load_frames(path):
    lookup = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            key = (int(row["frameX"]), int(row["frameY"]), int(row["frameW"]), int(row["frameH"]))
            lookup[key] = row["frameKey"]
    return lookup

FRAMES = load_frames(FRAMES_FILEPATH)

def resolve_frame_name(obj):
    if None in (obj.frameX, obj.frameY, obj.frameW, obj.frameH):
        return obj.frameKey or "unknown"
    key = (int(obj.frameX), int(obj.frameY), int(obj.frameW), int(obj.frameH))
    return FRAMES.get(key, obj.frameKey or "unknown")

# --- WebSocket connection manager ---
class ConnectionManager:
    def __init__(self):
        self.clients: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.append(ws)

    def disconnect(self, ws: WebSocket):
        self.clients.remove(ws)

    async def broadcast(self, data: str):
        dead = []
        for client in self.clients:
            try:
                await client.send_text(data)
            except Exception:
                dead.append(client)
        for c in dead:
            self.clients.remove(c)

manager = ConnectionManager()

# --- FastAPI app ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class Renderable(BaseModel):
    type: str
    name: Optional[str] = None
    x: Optional[int] = None
    y: Optional[int] = None
    alpha: Optional[float] = None
    texURL: Optional[str] = None
    frameKey: Optional[str] = None
    frameX: Optional[float] = None
    frameY: Optional[float] = None
    frameW: Optional[float] = None
    frameH: Optional[float] = None

class PixiPayload(BaseModel):
    ts: int
    page: str
    pixiVersion: Optional[str] = None
    renderables: list[Renderable]

_latest_payload: str | None = None
MIN_RENDERABLES = 5  # ignore payloads with fewer objects than this

@app.post("/pixi-ingest", status_code=204)
async def ingest(payload: PixiPayload):
    global _latest_payload
    if len(payload.renderables) < MIN_RENDERABLES:
        return
    for obj in payload.renderables:
        name = resolve_frame_name(obj)
        print(f"{name} @ ({obj.x}, {obj.y})")
    _latest_payload = payload.model_dump_json()

@app.get("/pixi-latest")
async def latest():
    return Response(content=_latest_payload or "{}", media_type="application/json")

# --- Selenium ---
INJECT_SCRIPT_FILEPATH = Path("js") / "pixi4-render-spy.js"

def run_server():
    uvicorn.run(app, host="0.0.0.0", port=5000)

def run_browser():
    with open(INJECT_SCRIPT_FILEPATH, "r") as f:
        js = f.read()

    d = Driver(uc=True, chromium_arg="--disable-web-security")
    d.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": js})
    d.get("https://copter.io")
    input("Press Enter to stop...")
    d.quit()

if __name__ == "__main__":
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    run_browser()