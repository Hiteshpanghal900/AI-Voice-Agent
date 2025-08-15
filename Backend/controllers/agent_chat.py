import os
from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from .helper_functions import (
    transcribe_data,
    add_to_history,
    get_history,
    call_genai_llm,
    generate_murf_audio)


router = APIRouter()


@router.post("/agent/chat/{session_id}")
async def agent_chat(session_id: str, audio: UploadFile = File(...)):
    try:
        # Convert audio to text (STT)
        audio_bytes = await audio.read()

        # Error handling for AssemblyAI transcription
        try:
            transcript = await transcribe_data(audio_bytes) 
        except Exception as e:
            fallback_msg = "I'm having trouble connecting right now."
            audio_urls = await generate_murf_audio(fallback_msg)
            add_to_history(session_id, "assistant", fallback_msg)
            return JSONResponse({
                "transcript": "",
                "response": fallback_msg,
                "audio_urls": audio_urls,
                "history": await get_history(session_id)
            })

        # Add user message to chat history
        add_to_history(session_id, "user", transcript)

        # Call LLM
        llm_response = await call_genai_llm(transcript, session_id)
        add_to_history(session_id, "assistant", llm_response)

        # LLM response to speech
        audio_urls = await generate_murf_audio(llm_response)

        return JSONResponse({
            "transcript": transcript,
            "response": llm_response,
            "audio_urls": audio_urls,
            "history": await get_history(session_id) 
        })
    
    except Exception as e:
        # Final safeguard for any unexpected error
        fallback_msg = "I'm having trouble connecting right now."
        audio_urls = await generate_murf_audio(fallback_msg)
        return JSONResponse({
            "transcript": "",
            "response": fallback_msg,
            "audio_urls": audio_urls,
            "history": []
        })


@router.get("/agent/chat/{session_id}/history")
async def chat_history(session_id):
    history = await get_history(session_id)
    return JSONResponse({
        "history": history})

