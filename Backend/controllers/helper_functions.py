import assemblyai as aai
from murf import Murf
from dotenv import load_dotenv
import os
import asyncio
from typing import Dict, List
import google.generativeai as genai

load_dotenv()

ASSEMBLY_API_KEY = os.getenv("ASSEMBLY_API_KEY")
MURF_API_KEY = os.getenv("MURF_API_KEY")

MURF_CHARACTER_LIMIT = 3000

aai.settings.api_key = ASSEMBLY_API_KEY
murf_client = Murf(api_key=MURF_API_KEY)


# ===================== In-memory datastore for user chat ============================
chat_history_store: Dict[str, List[Dict[str, str]]] = {}


# Splits the text into batches because murf can only generate audio for 3000 chars at a time.
def split_text(text, limit=3000):
    return [text[i:i+limit] for i in range(0, len(text), limit)]


# Transcribe audio using AssemblyAI SDK
async def transcribe_data(audio_bytes: bytes) -> str:
    def sync_transcribe():
        if not aai.settings.api_key:
            raise ValueError("Missing AssemblyAI API key")
        
        transcriber = aai.Transcriber()
        transcript = transcriber.transcribe(data = audio_bytes)
        return transcript.text
        
    return await asyncio.to_thread(sync_transcribe)


# Generates audio from text using Murf SDK
async def generate_murf_audio(text: str, voice_id: str = "en-US-terrell") -> str:
    audio_urls = []
    for chunk in split_text(text, MURF_CHARACTER_LIMIT):
        res = murf_client.text_to_speech.generate(
            text=chunk, voice_id=voice_id, format="MP3"
        )
        audio_urls.append(res.audio_file)
    return audio_urls




# =============================== Chat History Functions ================================

def add_to_history(session_id: str, role: str, content: str):
    """Append a message to chat history for a session."""
    if session_id not in chat_history_store:
        chat_history_store[session_id] = []
    
    chat_history_store[session_id].append({"role": role, "content": content})


async def get_history(session_id: str):
    """Get chat history for a session."""
    return chat_history_store.get(session_id, [])





# ================================ LLM Functions =========================================
async def call_genai_llm(prompt: str, session_id: str) -> str:
    """Call Google Gemini with chat history"""

    history = await get_history(session_id)

    conversation_text = "\n".join(
        [f"{m['role'].capitalize()}: {m['content']}" for m in history]
    )

    full_prompt = f"{conversation_text}\nUser: {prompt}\nAssistant:"

    def sync_call():
        model = genai.GenerativeModel("gemini-2.5-flash")
        response = model.generate_content(full_prompt)
        return response.text.strip()
    
    return await asyncio.to_thread(sync_call)
