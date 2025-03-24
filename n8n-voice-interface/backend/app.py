import logging
import os
import json
import base64
from typing import Optional
from fastapi import FastAPI, UploadFile, Form, HTTPException, BackgroundTasks, Request, Response, Cookie
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from backend.stt import transcribe_audio
from backend.webhook import send_to_n8n
from backend.tts import text_to_speech

# Konfiguracja loggera
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Inicjalizacja aplikacji FastAPI
app = FastAPI(
    title="N8N Voice Interface",
    description="Interfejs głosowy dla n8n wykorzystujący OpenAI's GPT-4o Transcribe",
    version="1.0.0"
)

# Dodaj middleware CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # W produkcji ustaw konkretne źródła
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Przechowuj ostatnią odpowiedź n8n do pobrania
last_n8n_response = None
last_tts_file_path = None

# Model do odbierania tekstu z n8n
class TextRequest(BaseModel):
    text: str

# Model odpowiedzi dla tekstu i audio
class AudioTextResponse(BaseModel):
    text: str
    audio_url: str

# Endpoint API dla transkrypcji
@app.post("/api/transcribe")
async def transcribe_endpoint(
    audio: UploadFile,
    webhook_url: str = Form(...),
    background_tasks: BackgroundTasks = None
):
    """
    Przetwórz audio, transkrybuj je i wyślij do webhooka n8n.
    """
    global last_n8n_response
    
    try:
        logger.info(f"Otrzymano plik audio: {audio.filename}, rozmiar: {audio.size} bajtów")
        
        # Transkrybuj audio
        transcription_result = await transcribe_audio(audio)
        
        if not transcription_result or not transcription_result.get("text"):
            logger.error("Transkrypcja nie powiodła się lub zwróciła pusty wynik")
            raise HTTPException(status_code=500, detail="Transkrypcja nie powiodła się")
        
        transcribed_text = transcription_result["text"]
        logger.info(f"Transkrypcja pomyślna: {transcribed_text[:50]}...")
        
        # Wyślij do webhooka n8n i pobierz odpowiedź
        n8n_response = await send_to_n8n(webhook_url, {"transcription": transcribed_text})
        
        # Zapisz odpowiedź n8n globalnie
        if isinstance(n8n_response, dict) and "text" in n8n_response:
            last_n8n_response = n8n_response
            logger.info(f"Zapisano odpowiedź n8n: {n8n_response['text'][:50]}...")
            
            # Generuj TTS dla odpowiedzi od razu, aby było gotowe
            if background_tasks:
                background_tasks.add_task(
                    generate_tts_for_response,
                    n8n_response["text"]
                )
            else:
                await generate_tts_for_response(n8n_response["text"])
                
            # Zwróć zarówno transkrypcję, jak i odpowiedź n8n
            return {
                "success": True,
                "text": transcribed_text,
                "n8nResponse": n8n_response
            }
        
        return {
            "success": True,
            "text": transcribed_text
        }
    
    except Exception as e:
        logger.error(f"Błąd przetwarzania żądania: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# Funkcja do generowania TTS dla odpowiedzi n8n
async def generate_tts_for_response(text: str):
    """
    Generuj TTS dla odpowiedzi n8n i zapisz ścieżkę pliku.
    """
    global last_tts_file_path
    
    try:
        file_path = await text_to_speech(text)
        last_tts_file_path = file_path
        logger.info(f"Wygenerowano TTS dla odpowiedzi n8n, zapisano do: {file_path}")
    except Exception as e:
        logger.error(f"Błąd generowania TTS dla odpowiedzi n8n: {str(e)}")

# Endpoint do pobierania ostatniej odpowiedzi n8n
@app.post("/api/get-n8n-response")
async def get_n8n_response():
    """
    Pobierz ostatnią odpowiedź n8n.
    """
    if not last_n8n_response:
        raise HTTPException(status_code=404, detail="Brak dostępnej odpowiedzi n8n")
    
    return last_n8n_response

# Zmodyfikowany endpoint do pobierania ostatniego pliku TTS z tekstem w treści odpowiedzi, nie w nagłówku
@app.get("/api/last-response-tts")
async def get_last_response_tts():
    """
    Pobierz plik TTS audio dla ostatniej odpowiedzi n8n.
    """
    global last_tts_file_path, last_n8n_response
    
    if not last_tts_file_path or not os.path.exists(last_tts_file_path):
        if last_n8n_response and "text" in last_n8n_response:
            # Spróbuj wygenerować plik TTS, jeśli nie istnieje
            try:
                last_tts_file_path = await text_to_speech(last_n8n_response["text"])
            except Exception as e:
                logger.error(f"Błąd generowania pliku TTS: {str(e)}")
                raise HTTPException(status_code=500, detail="Nie udało się wygenerować pliku TTS")
        else:
            raise HTTPException(status_code=404, detail="Brak dostępnego pliku TTS")
    
    # Pobierz zawartość tekstową
    text_content = last_n8n_response["text"] if last_n8n_response and "text" in last_n8n_response else ""
    
    # Utwórz unikalny URL audio używając ścieżki pliku
    audio_url = f"/api/audio/{os.path.basename(last_tts_file_path)}"
    
    # Zwróć JSON z tekstem i URL audio
    return {
        "text": text_content,
        "audio_url": audio_url
    }

# Endpoint do serwowania plików audio po nazwie pliku
@app.get("/api/audio/{filename}")
async def get_audio_file(filename: str):
    """
    Serwuj plik audio po nazwie pliku.
    """
    global last_tts_file_path
    
    if not last_tts_file_path or not os.path.exists(last_tts_file_path):
        raise HTTPException(status_code=404, detail="Nie znaleziono pliku audio")
    
    # Prosta walidacja, aby zapobiec atakom traversal path
    if os.path.basename(last_tts_file_path) != filename:
        raise HTTPException(status_code=403, detail="Dostęp zabroniony")
    
    # Strumień zawartości pliku bezpośrednio
    def iterfile():
        with open(last_tts_file_path, mode="rb") as file_like:
            yield from file_like
    
    return StreamingResponse(iterfile(), media_type="audio/mpeg")

# Nowy endpoint do odbierania tekstu z n8n i konwersji na mowę
@app.post("/api/speak")
async def speak_endpoint(request: TextRequest):
    """
    Odbierz tekst i konwertuj go na mowę.
    """
    global last_n8n_response, last_tts_file_path
    
    try:
        text = request.text
        logger.info(f"Otrzymano tekst do TTS: {text[:50]}...")
        
        # Zapisz jako ostatnią odpowiedź n8n dla wygody
        last_n8n_response = {"text": text}
        
        # Konwertuj tekst na mowę
        audio_path = await text_to_speech(text)
        
        # Zapisz ścieżkę pliku TTS
        last_tts_file_path = audio_path
        
        # Utwórz unikalny URL audio z ścieżki pliku
        audio_url = f"/api/audio/{os.path.basename(audio_path)}"
        
        # Zwróć JSON z tekstem i URL audio zamiast FileResponse
        return {
            "text": text,
            "audio_url": audio_url
        }
    
    except Exception as e:
        logger.error(f"Błąd przetwarzania żądania speak: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# Webhook endpoint, który może obsługiwać zarówno odbieranie tekstu z n8n, jak i wysyłanie transkrypcji do n8n
@app.post("/api/webhook/{webhook_id}")
async def webhook_endpoint(
    webhook_id: str,
    request: Request,
    background_tasks: BackgroundTasks
):
    """
    Dwukierunkowy endpoint webhooka dla integracji n8n.
    Może odbierać tekst z n8n i zwracać audio lub odbierać audio i wysyłać tekst do n8n.
    """
    global last_n8n_response, last_tts_file_path
    content_type = request.headers.get("content-type", "")
    
    try:
        if "multipart/form-data" in content_type:
            # To jest upload audio z frontendu
            form_data = await request.form()
            audio = form_data.get("audio")
            webhook_url = form_data.get("webhook_url")
            
            if not audio or not webhook_url:
                raise HTTPException(status_code=400, detail="Brak audio lub webhook_url")
            
            # Przetwórz jako upload audio (podobnie jak transcribe_endpoint)
            transcription_result = await transcribe_audio(audio)
            transcribed_text = transcription_result["text"]
            
            # Wyślij do webhooka n8n
            n8n_response = await send_to_n8n(webhook_url, {"transcription": transcribed_text})
            
            # Zapisz odpowiedź globalnie
            if isinstance(n8n_response, dict) and "text" in n8n_response:
                last_n8n_response = n8n_response
            
            return {
                "success": True,
                "text": transcribed_text,
                "n8nResponse": n8n_response if isinstance(n8n_response, dict) else None
            }
            
        else:
            # To jest odpowiedź tekstowa z n8n
            body = await request.json()
            
            if "text" not in body:
                raise HTTPException(status_code=400, detail="Brak pola 'text' w ciele żądania")
            
            # Zapisz jako ostatnią odpowiedź n8n
            last_n8n_response = {"text": body["text"]}
            
            # Konwertuj tekst na mowę
            audio_path = await text_to_speech(body["text"])
            
            # Zapisz ścieżkę pliku TTS
            last_tts_file_path = audio_path
            
            # Utwórz unikalny URL audio z ścieżki pliku
            audio_url = f"/api/audio/{os.path.basename(audio_path)}"
            
            # Zwróć JSON z tekstem i URL audio
            return {
                "text": body["text"],
                "audio_url": audio_url
            }
    
    except Exception as e:
        logger.error(f"Błąd przetwarzania żądania webhook: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# Endpoint sprawdzania stanu
@app.get("/api/health")
async def health_check():
    """
    Endpoint sprawdzania stanu, aby zweryfikować, czy API działa.
    """
    return {"status": "ok"}

# Zamontuj pliki statyczne dla frontendu
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

# Uruchom aplikację
if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
