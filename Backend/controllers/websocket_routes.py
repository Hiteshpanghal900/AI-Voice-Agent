from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
from pathlib import Path
from datetime import datetime, timezone
import assemblyai as aai
from assemblyai.streaming.v3 import (
    StreamingClient,
    StreamingClientOptions,
    StreamingEvents,
    StreamingParameters,
    BeginEvent,
    TurnEvent,
    TerminationEvent,
    StreamingError,
)
import asyncio
from dotenv import load_dotenv
import os
import json

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()


load_dotenv()
aai.settings.api_key = os.getenv("ASSEMBLY_API_KEY")

# Event Handlers
def on_begin(client: StreamingClient, event: BeginEvent):
    logger.info(f"AssemblyAI Session started: {event.id}")


def on_terminated(client: StreamingClient, event: TerminationEvent):
    logger.info(f"Session terminated after {event.audio_duration_seconds} seconds")

def on_error(client: StreamingClient, error: StreamingError):
    logger.error(f"AssemblyAI streaming error: {error}")


UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

@router.websocket("/ws/audio")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    outfile = UPLOAD_DIR / f"stream_{timestamp}.webm"
    logger.info(f"WebSocket connected. Writing audio to {outfile}")

    # Create streaming client with exact API host
    client = StreamingClient(
        StreamingClientOptions(
            api_key=aai.settings.api_key,
            api_host="streaming.assemblyai.com"
        )
    )

    mainLoop = asyncio.get_event_loop()

    # Event handlers
    def on_turn(client: StreamingClient, event: TurnEvent):
        if event.turn_is_formatted:
            logger.info({
                "Transcript": event.transcript,
                "EndOfTurn": event.end_of_turn
            })

            asyncio.run_coroutine_threadsafe(
                websocket.send_text(json.dumps({
                        "Transcript": event.transcript
                })), 
                mainLoop
            )


    # Register event handlers
    client.on(StreamingEvents.Begin, on_begin)
    client.on(StreamingEvents.Turn, on_turn)
    client.on(StreamingEvents.Termination, on_terminated)
    client.on(StreamingEvents.Error, on_error)

    # Connect streaming with parameters
    client.connect(
        StreamingParameters(
            sample_rate=16000, 
            format_turns=True,
        )
    )

    try:
        while True:
            data = await websocket.receive()
            if "bytes" in data:
                # Data is already PCM16, send directly to AssemblyAI in a thread.
                await asyncio.to_thread(client.stream, data["bytes"])

            elif "text" in data and data["text"] == "END":
                msg = data["text"]
                logger.info(f"Text msg from received: {msg}")
                await asyncio.to_thread(client.disconnect)
                break
    except WebSocketDisconnect:
        logger.info(f"Client disconnected")
    finally:
        # Make sure the streaming client is closed
        await asyncio.to_thread(client.disconnect)

