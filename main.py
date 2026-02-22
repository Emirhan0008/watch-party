import logging
import json
from typing import List, Dict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import os

# Logging configuration
if not os.path.exists("logs"):
    os.makedirs("logs")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("logs/app.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("WatchParty")

app = FastAPI(title="Watch Party API")

# Connection Manager for WebSockets
import uuid

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.usernames: Dict[str, str] = {}
        self.broadcaster_id: str = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        client_id = str(uuid.uuid4())[:8]
        self.active_connections[client_id] = websocket
        self.usernames[client_id] = f"Misafir_{client_id}"
        
        logger.info(f"YENİ BAĞLANTI: {client_id}. Toplam: {len(self.active_connections)}")
        
        # İstemciye başlangıç bilgilerini gönder
        await websocket.send_text(json.dumps({
            "type": "init", 
            "id": client_id, 
            "username": self.usernames[client_id],
            "broadcaster": self.broadcaster_id
        }))
        
        # Diğerlerine yeni birinin geldiğini haber ver (Host'un el sıkışma başlatması için kritik)
        await self.broadcast(json.dumps({"type": "new-client", "id": client_id}), exclude=client_id)
        
        await self.broadcast_user_list()
        return client_id

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            if client_id in self.usernames:
                del self.usernames[client_id]
            if self.broadcaster_id == client_id:
                self.broadcaster_id = None
            logger.info(f"BAĞLANTI KESİLDİ: {client_id}")

    async def broadcast_user_list(self):
        user_list = [{"id": k, "name": v} for k, v in self.usernames.items()]
        await self.broadcast(json.dumps({
            "type": "user-list", 
            "users": user_list,
            "broadcaster": self.broadcaster_id
        }))

    async def broadcast(self, message: str, exclude: str = None):
        for cid, connection in self.active_connections.items():
            if cid != exclude:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    logger.error(f"Broadcast Hatası ({cid}): {e}")

    async def send_to(self, message: str, to_id: str):
        if to_id in self.active_connections:
            try:
                await self.active_connections[to_id].send_text(message)
            except Exception as e:
                logger.error(f"Özel Mesaj Hatası ({to_id}): {e}")

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_id = await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            
            if msg["type"] == "set-name":
                manager.usernames[client_id] = msg["name"]
                await manager.broadcast_user_list()
            
            elif msg["type"] == "start-share":
                if not manager.broadcaster_id:
                    manager.broadcaster_id = client_id
                    await manager.broadcast_user_list()
            
            elif msg["type"] == "stop-share":
                if manager.broadcaster_id == client_id:
                    manager.broadcaster_id = None
                    await manager.broadcast_user_list()

            elif "to" in msg:
                msg["from"] = client_id
                await manager.send_to(json.dumps(msg), msg["to"])
            else:
                msg["from"] = client_id
                await manager.broadcast(json.dumps(msg), exclude=client_id)
                
    except WebSocketDisconnect:
        manager.disconnect(client_id)
        await manager.broadcast_user_list()
    except Exception as e:
        logger.error(f"WebSocket error ({client_id}): {e}")
        manager.disconnect(client_id)
        await manager.broadcast_user_list()

from fastapi.responses import HTMLResponse, FileResponse

# ... manager and websocket logic above ...

# Static files directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

@app.get("/")
async def get_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"error": "index.html bulunamadı"}

# Diğer statik dosyalar (css, js) için
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    app.mount("/css", StaticFiles(directory=os.path.join(STATIC_DIR, "css")), name="css")
    app.mount("/js", StaticFiles(directory=os.path.join(STATIC_DIR, "js")), name="js")
    logger.info(f"Statik dosyalar yüklendi: {STATIC_DIR}")
else:
    logger.error("Statik klasör bulunamadı!")

import subprocess
import time

def start_ngrok():
    ngrok_path = r"C:\Users\YILMAZ\Downloads\Compressed\ngrok-v3-stable-windows-amd64\ngrok.exe"
    try:
        # Ngrok'u yeni bir terminal penceresinde başlat
        # 'start' komutu Windows'ta yeni pencere açar
        command = f'start "Ngrok Tunnel" "{ngrok_path}" http 8000'
        subprocess.Popen(command, shell=True)
        logger.info("Ngrok tüneli yeni pencerede başlatıldı.")
    except Exception as e:
        logger.error(f"Ngrok başlatılamadı: {e}")

if __name__ == "__main__":
    import uvicorn
    try:
        start_ngrok()
        logger.info("Sunucu başlatılıyor: http://localhost:8000")
        uvicorn.run(app, host="0.0.0.0", port=8000)
    except Exception as e:
        logger.error(f"Kritik hata: {e}")
    finally:
        print("\n" + "="*50)
        print("Uygulama kapandı. Logları kontrol edebilirsiniz.")
        input("Pencereyi kapatmak için Enter'a basın...")
