from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
from pathlib import Path
from datetime import datetime, timezone
import assemblyai as aai
import websockets
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
import google.generativeai as genai

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

load_dotenv()
aai.settings.api_key = os.getenv("ASSEMBLY_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MURF_API_KEY = os.getenv("MURF_API_KEY")

# Configure Gemini
genai.configure(api_key=GEMINI_API_KEY)

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

    transcripts = []  # Move transcripts inside the websocket scope
    client = None
    
    try:
        # ==========================================
        # AssemblyAI setup
        # ==========================================
        client = StreamingClient(
            StreamingClientOptions(
                api_key=aai.settings.api_key,
                api_host="streaming.assemblyai.com"
            )
        )

        mainLoop = asyncio.get_event_loop()

        # Event handlers for converting User Speech Input into Transcript
        def on_turn(client: StreamingClient, event: TurnEvent):
            if event.turn_is_formatted:
                transcripts.append(event.transcript)

                logger.info({
                    "transcript": event.transcript,
                    "EndOfTurn": event.end_of_turn,
                })

                asyncio.run_coroutine_threadsafe(
                    websocket.send_text(json.dumps({
                        "transcript": event.transcript,
                        "userType": "user",
                        "type": "transcript"
                    })), 
                    mainLoop
                )

        # Register event handlers
        client.on(StreamingEvents.Begin, on_begin)
        client.on(StreamingEvents.Turn, on_turn)
        client.on(StreamingEvents.Termination, on_terminated)
        client.on(StreamingEvents.Error, on_error)

        # Connect AssemblyAI streaming with parameters
        client.connect(
            StreamingParameters(
                sample_rate=16000, 
                format_turns=True,
            )
        )

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive(), timeout=30.0)
            except asyncio.TimeoutError:
                logger.warning("WebSocket receive timeout")
                break
                
            if "bytes" in data:
                # Data is already PCM16, send directly to AssemblyAI in a thread.
                await asyncio.to_thread(client.stream, data["bytes"])

            elif "text" in data:
                message = data["text"]
                logger.info(f"Received text message: {message}")
                
                if message == "STOP":
                    full_transcript = " ".join(transcripts)
                    logger.info(f"Sending full message to Gemini: {full_transcript}")

                    try:
                        await stream_llm_response(full_transcript, websocket)
                    except Exception as e:
                        logger.error(f"Failed to generate content from Gemini: {e}")
                        await websocket.send_text(json.dumps({
                            "type": "error", 
                            "error": str(e)
                        }))

                    transcripts.clear()
                
                elif message == "END":
                    logger.info("Ending session")
                    break
                    
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Make sure the streaming client is closed
        if client:
            try:
                await asyncio.to_thread(client.disconnect)
            except Exception as e:
                logger.error(f"Error disconnecting AssemblyAI client: {e}")

# =========================================================================
# GEMINI Setup -> User Speech Transcript from Assembly AI to Gemini Response
# Sending this response to Client and Murf for speech conversion
# =========================================================================

async def stream_llm_response(prompt: str, websocket: WebSocket):
    try:
        model = genai.GenerativeModel("gemini-2.0-flash-exp")
        response = model.generate_content(
            prompt, 
            stream=True,
            generation_config=genai.types.GenerationConfig(
                temperature=0.7,
                max_output_tokens=1000,
            )
        )
        
        final_response = ""
        for chunk in response:
            if chunk.text:
                final_response += chunk.text
                logger.debug(f"LLM Chunk: {chunk.text}")

                await websocket.send_text(json.dumps({
                    "type": "transcript", 
                    "text": chunk.text, 
                    "userType": "assistant"
                }))
        
        logger.info("LLM response complete")
        await websocket.send_text(json.dumps({
            "type": "end_of_llm"
        }))
        
        if final_response.strip():
            await send_to_murf(final_response, websocket)
        else:
            logger.warning("Empty response from Gemini")
            await websocket.send_text(json.dumps({
                "type": "end_of_audio"
            }))
            
    except Exception as e:
        logger.error(f"Error in stream_llm_response: {e}")
        raise

# ====================================================================
# MURF AI SETUP -> Sending GEMINI Response to MURF to convert to speech
# And sending this converting audio output to the client
# ====================================================================

CONTEXT_ID = "turn_1"
MURF_WS_URL = "wss://api.murf.ai/v1/speech/stream-input"

async def send_to_murf(text: str, websocket: WebSocket):
    """Send text to Murf AI for TTS conversion and stream audio back to client"""
    
    try:
        logger.info(f"Connecting to Murf with text: {text[:50]}...")
        
        # Connect to Murf WebSocket with proper parameters
        uri = f"{MURF_WS_URL}?api-key={MURF_API_KEY}&sample_rate=44100&channel_type=MONO&format=MP3"
        
        async with websockets.connect(uri) as ws:
            # Send TTS request to Murf
            await ws.send(json.dumps({
                "context_id": CONTEXT_ID,
                "voiceId": "en-US-terrel", 
                "format": "mp3",
                "text": text,
                "model": "murf",  # Add model parameter
                "speed": 1.0,     # Normal speed
                "pitch": 0        # Normal pitch
            }))

            logger.info("Sent TTS request to Murf, waiting for audio chunks...")
            audio_chunks_received = 0

            while True:
                try:
                    # Wait for response with timeout
                    msg = await asyncio.wait_for(ws.recv(), timeout=10.0)
                    data = json.loads(msg)

                    if "audio" in data:
                        audio_chunks_received += 1
                        base64audio = data["audio"]
                        
                        # Send audio chunk to client
                        await websocket.send_text(json.dumps({
                            "type": "audio_chunk",
                            "data": base64audio
                        }))
                        
                        logger.debug(f"Sent audio chunk {audio_chunks_received} (size: {len(base64audio)})")

                    elif "error" in data:
                        logger.error(f"Murf error: {data['error']}")
                        break

                    elif data.get("type") == "end":
                        logger.info("Murf indicated end of audio stream")
                        break

                except asyncio.TimeoutError:
                    logger.info("Murf timeout - assuming end of audio stream")
                    break
                    
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse Murf response: {e}")
                    break

            logger.info(f"Murf audio streaming complete. Total chunks: {audio_chunks_received}")
            
    except Exception as e:
        logger.error(f"Error in send_to_murf: {e}")
    finally:
        # Always send end_of_audio signal
        try:
            await websocket.send_text(json.dumps({
                "type": "end_of_audio"
            }))
        except Exception as e:
            logger.error(f"Error sending end_of_audio: {e}")