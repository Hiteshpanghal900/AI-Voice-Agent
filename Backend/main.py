from fastapi import FastAPI
from websocket_routes import router as ws_router

app = FastAPI()

# include websocket routes
app.include_router(ws_router)

@app.get("/")
async def root():
    return {"message": "FastAPI is running"}
