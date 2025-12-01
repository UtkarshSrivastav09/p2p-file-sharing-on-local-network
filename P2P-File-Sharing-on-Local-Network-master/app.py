from fastapi import FastAPI, File, UploadFile, Request, HTTPException
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import shutil
import socket
import uvicorn
import threading
import time
from typing import Dict

# ------------- CONFIG -------------
UPLOAD_DIR = "uploads"
PEER_BROADCAST_PORT = 37020
APP_PORT = 8000
PEER_EXPIRY_SECONDS = 25
# ----------------------------------

app = FastAPI()
templates = Jinja2Templates(directory="templates")

# Serve static files (JS, CSS, images)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Allow LAN access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

peers: Dict[str, float] = {}


def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.254.254.254", 1))
        local_ip = s.getsockname()[0]
    except Exception:
        local_ip = "127.0.0.1"
    finally:
        s.close()
    return local_ip


@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/info")
async def api_info():
    local_ip = app.state.local_ip
    return {"local_ip": local_ip, "port": APP_PORT}


@app.get("/api/files")
async def api_files():
    files = []
    for f in sorted(os.listdir(UPLOAD_DIR)):
        path = os.path.join(UPLOAD_DIR, f)
        if os.path.isfile(path):
            stat = os.stat(path)
            files.append({
                "name": f,
                "size": stat.st_size,
                "mtime": int(stat.st_mtime)
            })
    return files


# ----------------- NEW: Storage Used API -----------------
def _human_readable_size(num_bytes: int) -> str:
    # Simple human-readable conversion
    step = 1024.0
    if num_bytes < step:
        return f"{num_bytes} B"
    for unit in ["KB", "MB", "GB", "TB"]:
        num_bytes /= step
        if num_bytes < step:
            return f"{num_bytes:.2f} {unit}"
    return f"{num_bytes:.2f} PB"


@app.get("/api/storage")
async def api_storage():
    total = 0
    # ensure upload dir exists
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    for f in os.listdir(UPLOAD_DIR):
        path = os.path.join(UPLOAD_DIR, f)
        if os.path.isfile(path):
            try:
                total += os.path.getsize(path)
            except OSError:
                continue
    return {"used": total, "used_human": _human_readable_size(total)}
# --------------------------------------------------------


@app.post("/uploadfile/")
async def upload_file(file: UploadFile = File(...)):
    filename = os.path.basename(file.filename)
    dest = os.path.join(UPLOAD_DIR, filename)
    # ensure upload dir exists
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(dest, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return RedirectResponse(url="/", status_code=303)


@app.get("/downloadfile/{filename}")
async def download_file(filename: str):
    path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(path):
        return FileResponse(path, filename=filename)
    raise HTTPException(status_code=404, detail="File not found")


@app.post("/deletefile/{filename}")
async def delete_file(filename: str):
    path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(path):
        os.remove(path)
        return RedirectResponse(url="/", status_code=303)
    raise HTTPException(status_code=404, detail="File not found")


# -------------------- P2P Networking --------------------
def udp_broadcast_loop(stop, local_ip):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    msg = f"PEER:{local_ip}:{APP_PORT}".encode()
    while not stop.is_set():
        try:
            sock.sendto(msg, ("<broadcast>", PEER_BROADCAST_PORT))
            sock.sendto(msg, ("255.255.255.255", PEER_BROADCAST_PORT))
        except:
            pass
        stop.wait(5)
    sock.close()


def udp_listen_loop(stop, local_ip):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", PEER_BROADCAST_PORT))
    sock.settimeout(1)
    while not stop.is_set():
        try:
            data, addr = sock.recvfrom(1024)
            msg = data.decode(errors="ignore")
            if msg.startswith("PEER:"):
                ip = msg.split(":")[1]
                if ip != local_ip:
                    peers[ip] = time.time()
        except socket.timeout:
            continue
        except:
            continue
    sock.close()


@app.get("/api/peers")
async def api_peers():
    now = time.time()
    valid = []
    for ip, ts in list(peers.items()):
        if now - ts < PEER_EXPIRY_SECONDS:
            valid.append({"ip": ip, "url": f"http://{ip}:{APP_PORT}"})
        else:
            peers.pop(ip, None)
    return valid


def start_peer_threads(local_ip):
    stop = threading.Event()
    threading.Thread(target=udp_broadcast_loop, args=(stop, local_ip), daemon=True).start()
    threading.Thread(target=udp_listen_loop, args=(stop, local_ip), daemon=True).start()
    return stop


def create_app():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    local_ip = get_local_ip()
    app.state.local_ip = local_ip
    print(f"----> Server running at http://{local_ip}:{APP_PORT}")
    app.state.stop_event = start_peer_threads(local_ip)
    return app


if __name__ == "__main__":
    uvicorn.run("app:create_app", host="0.0.0.0", port=APP_PORT, reload=True)
