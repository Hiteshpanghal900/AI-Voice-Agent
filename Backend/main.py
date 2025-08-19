from fastapi import FastAPI, Request, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import requests
import os
from dotenv import load_dotenv
from pydantic import BaseModel
from pathlib import Path
import shutil


from murf import Murf

load_dotenv()

# For CORS configurations
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # or ["http://127.0.0.1:5500"] for stricter config
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Setting the pathways for baseDir and frontendDir
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")


app.mount("/static", StaticFiles(directory= os.path.join(FRONTEND_DIR, "static")), name="static")




from controllers.tts_echo import router as tts_router
from controllers.llm_query import router as llm_router
from controllers.agent_chat import router as agent_router
from controllers.websocket_routes import router as ws_router

app.include_router(tts_router)
app.include_router(llm_router)
app.include_router(agent_router)
app.include_router(ws_router)           #include websocket route




# Home function to serve the html
@app.get('/')
def home():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))