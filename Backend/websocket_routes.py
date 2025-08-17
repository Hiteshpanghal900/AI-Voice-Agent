from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
from pathlib import Path
from datetime import datetime, timezone
import asyncio

# setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

@router.websocket("/ws/audio")
async def websocket_endpoint(websocket: WebSocket):
    """
    Receives binary audio chunks and writes them to a .webm file
    - Opens a new file per connection
    - Binary frames are appended to the file
    - Text frame "END" (or client disconnected) finalizes the file
    """
    await websocket.accept()

    # Make a unique filename per connection
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    outfile = Path("uploads") / f"stream_{timestamp}.webm"

    logger.info(f"WebSocket connected. Writing audio to {outfile}")

    try:
        with outfile.open("wb") as audio_file:
            while True:
                msg = await websocket.receive()

                if msg["type"] == "websocket.disconnect":
                    logger.info("Client disconnected")
                    break

                if "text" in msg:
                    text = msg["text"]
                    logger.info(f"Text message: {text}")
                    if text.strip().upper() == "END":
                        logger.info("Received END signal. Closing stream.")
                        break

                elif "bytes" in msg:
                    audio_file.write(msg["bytes"])

    except Exception as e:
        logger.error(f"Error while receiving audio: {e}")
    finally:
        logger.info(f"Saved audio file: {outfile}")
