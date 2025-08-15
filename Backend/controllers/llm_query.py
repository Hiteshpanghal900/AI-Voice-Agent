from dotenv import load_dotenv
import os
from fastapi import APIRouter, HTTPException, UploadFile, File
import google.generativeai as genai
from pydantic import BaseModel
import assemblyai as aai
from murf import Murf


from .helper_functions import transcribe_data, generate_murf_audio

load_dotenv()
router = APIRouter()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


# Pydantic model for the request body
# This provides automatic validation and a clear schema for the endpoint.
class LLMQueryRequest(BaseModel):
    text: str


# LLM Endpoint 
@router.post('/llm/query')
async def llm_query(audio: UploadFile = File(...)):

    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="API key not found. Please set the 'GEMINI_API_KEY' environment variable."
        )
    
    genai.configure(api_key=GEMINI_API_KEY)

    try:
        # Read audio file bytes
        audio_bytes = await audio.read()

        # Step 1: Transcribe audio
        transcript = await transcribe_data(audio_bytes)

        # Step 2: Send transcript to Gemini
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = model.generate_content(transcript)
        generated_text = response.text

        # Step 3: Generate Murf audio for Gemini output (handles 3000-char limit)
        audio_urls = await generate_murf_audio(generated_text)

        return {
            "transcript": transcript,
            "audio_urls": audio_urls
        }

    except Exception as e:
        print(f"An error occured: {e}")

        raise HTTPException(
            status_code=500,
            detail=f"An error occured in the pipeline: {e}"
        )