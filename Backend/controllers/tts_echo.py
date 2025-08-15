import os 
from dotenv import load_dotenv
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse

from murf import Murf
import assemblyai as aai

load_dotenv()
router = APIRouter()

ASSEMBLY_API_KEY = os.getenv("ASSEMBLY_API_KEY")
MURF_API_KEY = os.getenv("MURF_API_KEY")


aai.settings.api_key = ASSEMBLY_API_KEY
murf_client = Murf(api_key=MURF_API_KEY)



def transcribe_data(audio_bytes: bytes) -> str:
    transcriber = aai.Transcriber()
    transcript = transcriber.transcribe(data = audio_bytes)
    return transcript.text

def generate_murf_audio(text: str, voice_id: str = "en-US-terrell") -> str:
    res = murf_client.text_to_speech.generate(
        text=text,
        voice_id=voice_id,
        format="MP3"
    )
    return res.audio_file



@router.post('/tts/echo')
async def tts_echo(audio: UploadFile = File(...)):
    try:
        audio_bytes = await audio.read()
        transcript = transcribe_data(audio_bytes)
        audio_url = generate_murf_audio(transcript)

        return JSONResponse({
            'transcript': transcript,
            'audio_url': audio_url
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)