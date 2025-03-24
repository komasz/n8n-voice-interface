import logging
import os
import uuid
from typing import Optional
from fastapi import FastAPI, UploadFile, Form, HTTPException, BackgroundTasks, Request, Response, Cookie, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Importy lokalnych modułów
from backend.stt import transcribe_service
from backend.tts import tts_service
from backend.webhook import webhook_service
from backend.session import SessionStorage
from backend.utils.file_manager import FileManager

# Konfiguracja loggera
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Model dla odbierania tekstu z n8n
class TextRequest(BaseModel):
    text: str

# Inicjalizacja SessionStorage
session_storage = SessionStorage()

# Inicjalizacja FastAPI
app = FastAPI(
    title="N8N Voice Interface",
    description="Interfejs głosowy dla przepływów n8n wykorzystujący OpenAI GPT-4o Transcribe",
    version="1.0.0"
)

# Dodaj middleware CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # W produkcji należy ustawić konkretne źródła
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Funkcja do uzyskania ID sesji z ciasteczka lub utworzenia nowej
async def get_session_id(
    session_id: Optional[str] = Cookie(None)
) -> str:
    """
    Pobiera ID sesji z ciasteczka lub tworzy nowe
    
    Args:
        session_id: ID sesji z ciasteczka (opcjonalne)
        
    Returns:
        ID sesji (istniejące lub nowe)
    """
    return session_storage.get_or_create_session_id(session_id)

# Funkcja do generowania odpowiedzi TTS dla sesji
async def generate_tts_for_session(session_id: str, text: str) -> None:
    """
    Generuje TTS dla odpowiedzi n8n i zapisuje ścieżkę w sesji
    
    Args:
        session_id: ID sesji
        text: Tekst do konwersji na mowę
    """
    try:
        file_path = await tts_service.text_to_speech(text)
        session_storage.update_tts_file_path(session_id, file_path)
        logger.info(f"Wygenerowano TTS dla odpowiedzi n8n, zapisano do: {file_path}")
    except Exception as e:
        logger.error(f"Błąd generowania TTS dla odpowiedzi n8n: {str(e)}")

# Endpoint transkrypcji
@app.post("/api/transcribe")
async def transcribe_endpoint(
    audio: UploadFile,
    webhook_url: str = Form(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    session_id: str = Depends(get_session_id)
):
    """
    Przetwarza audio, transkrybuje je i wysyła do webhooka n8n.
    
    Args:
        audio: Plik audio
        webhook_url: URL webhooka n8n
        background_tasks: Zadania w tle FastAPI
        session_id: ID sesji (z Depends)
        
    Returns:
        JSON z transkrypcją i odpowiedzią n8n
    """
    try:
        logger.info(f"Otrzymano plik audio: {audio.filename}, rozmiar: {audio.size} bajtów, sesja: {session_id}")
        
        # Transkrybuj audio
        transcription_result = await transcribe_service.transcribe_audio(audio)
        
        if not transcription_result or not transcription_result.get("text"):
            logger.error("Transkrypcja nie powiodła się lub zwróciła pusty wynik")
            raise HTTPException(status_code=500, detail="Transkrypcja nie powiodła się")
        
        transcribed_text = transcription_result["text"]
        logger.info(f"Transkrypcja pomyślna: {transcribed_text[:50]}...")
        
        # Wyślij do webhooka n8n i pobierz odpowiedź
        n8n_response = await webhook_service.send_to_n8n(webhook_url, {"transcription": transcribed_text})
        
        # Zapisz odpowiedź n8n w sesji
        if isinstance(n8n_response, dict) and "text" in n8n_response:
            session_storage.update_n8n_response(session_id, n8n_response)
            logger.info(f"Zapisano odpowiedź n8n w sesji: {n8n_response['text'][:50]}...")
            
            # Generuj TTS dla odpowiedzi w tle
            background_tasks.add_task(
                generate_tts_for_session,
                session_id,
                n8n_response["text"]
            )
            
            # Zwróć zarówno transkrypcję, jak i odpowiedź n8n
            response_data = {
                "success": True,
                "text": transcribed_text,
                "n8nResponse": n8n_response
            }
        else:
            response_data = {
                "success": True,
                "text": transcribed_text
            }
            
        # Zwróć odpowiedź z ciasteczkiem sesji
        response = JSONResponse(content=response_data)
        response.set_cookie(key="session_id", value=session_id, httponly=True, samesite="lax")
        return response
    
    except Exception as e:
        logger.error(f"Błąd przetwarzania żądania: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# Endpoint do pobierania ostatniej odpowiedzi n8n
@app.post("/api/get-n8n-response")
async def get_n8n_response(
    session_id: str = Depends(get_session_id)
):
    """
    Pobiera ostatnią odpowiedź n8n dla sesji
    
    Args:
        session_id: ID sesji (z Depends)
        
    Returns:
        Ostatnia odpowiedź n8n dla sesji
    """
    n8n_response = session_storage.get_n8n_response(session_id)
    
    if not n8n_response:
        raise HTTPException(status_code=404, detail="Brak dostępnej odpowiedzi n8n")
    
    return n8n_response

# Endpoint do pobierania ostatniego pliku TTS
@app.get("/api/last-response-tts")
async def get_last_response_tts(
    session_id: str = Depends(get_session_id),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    Pobiera plik TTS dla ostatniej odpowiedzi n8n
    
    Args:
        session_id: ID sesji (z Depends)
        background_tasks: Zadania w tle FastAPI
        
    Returns:
        JSON z tekstem i URL audio
    """
    tts_file_path = session_storage.get_tts_file_path(session_id)
    n8n_response = session_storage.get_n8n_response(session_id)
    
    if not tts_file_path or not os.path.exists(tts_file_path):
        if n8n_response and "text" in n8n_response:
            # Spróbuj wygenerować plik TTS, jeśli nie istnieje
            try:
                tts_file_path = await tts_service.text_to_speech(n8n_response["text"])
                session_storage.update_tts_file_path(session_id, tts_file_path)
            except Exception as e:
                logger.error(f"Błąd generowania pliku TTS: {str(e)}")
                raise HTTPException(status_code=500, detail="Nie udało się wygenerować pliku TTS")
        else:
            raise HTTPException(status_code=404, detail="Brak dostępnego pliku TTS")
    
    # Pobierz zawartość tekstową
    text_content = n8n_response["text"] if n8n_response and "text" in n8n_response else ""
    
    # Utwórz unikalny URL audio z ścieżki pliku
    audio_url = f"/api/audio/{os.path.basename(tts_file_path)}"
    
    # Zwróć JSON z tekstem i URL audio
    return {
        "text": text_content,
        "audio_url": audio_url
    }

# Endpoint do serwowania plików audio po nazwie
@app.get("/api/audio/{filename}")
async def get_audio_file(
    filename: str,
    session_id: str = Depends(get_session_id)
):
    """
    Serwuje plik audio po nazwie pliku
    
    Args:
        filename: Nazwa pliku
        session_id: ID sesji (z Depends)
        
    Returns:
        Strumień pliku audio
    """
    tts_file_path = session_storage.get_tts_file_path(session_id)
    
    if not tts_file_path or not os.path.exists(tts_file_path):
        raise HTTPException(status_code=404, detail="Nie znaleziono pliku audio")
    
    # Prosta walidacja, aby zapobiec atakom traversal path
    if os.path.basename(tts_file_path) != filename:
        raise HTTPException(status_code=403, detail="Dostęp zabroniony")
    
    # Strumień zawartości pliku bezpośrednio
    def iterfile():
        with open(tts_file_path, mode="rb") as file_like:
            yield from file_like
    
    return StreamingResponse(iterfile(), media_type="audio/mpeg")

# Nowy endpoint do odbierania tekstu z n8n i konwersji na mowę
@app.post("/api/speak")
async def speak_endpoint(
    request: TextRequest,
    session_id: str = Depends(get_session_id)
):
    """
    Odbiera tekst i konwertuje go na mowę
    
    Args:
        request: Żądanie zawierające tekst
        session_id: ID sesji (z Depends)
        
    Returns:
        JSON z tekstem i URL audio
    """
    try:
        text = request.text
        logger.info(f"Otrzymano tekst do TTS: {text[:50]}...")
        
        # Zapisz jako ostatnią odpowiedź n8n dla wygody
        n8n_response = {"text": text}
        session_storage.update_n8n_response(session_id, n8n_response)
        
        # Konwertuj tekst na mowę
        audio_path = await tts_service.text_to_speech(text)
        
        # Zapisz ścieżkę pliku TTS
        session_storage.update_tts_file_path(session_id, audio_path)
        
        # Utwórz unikalny URL audio z ścieżki pliku
        audio_url = f"/api/audio/{os.path.basename(audio_path)}"
        
        # Zwróć JSON z tekstem i URL audio
        response = JSONResponse(content={
            "text": text,
            "audio_url": audio_url
        })
        response.set_cookie(key="session_id", value=session_id, httponly=True, samesite="lax")
        return response
    
    except Exception as e:
        logger.error(f"Błąd przetwarzania żądania speak: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# Endpoint webhooka, który może obsługiwać zarówno odbieranie tekstu z n8n, jak i wysyłanie transkrypcji do n8n
@app.post("/api/webhook/{webhook_id}")
async def webhook_endpoint(
    webhook_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    session_id: str = Depends(get_session_id)
):
    """
    Dwukierunkowy endpoint webhooka do integracji z n8n.
    Może odbierać tekst z n8n i zwracać audio lub odbierać audio i wysyłać tekst do n8n.
    
    Args:
        webhook_id: ID webhooka
        request: Obiekt żądania FastAPI
        background_tasks: Zadania w tle FastAPI
        session_id: ID sesji (z Depends)
        
    Returns:
        Odpowiednia odpowiedź w zależności od typu żądania
    """
    content_type = request.headers.get("content-type", "")
    
    try:
        if "multipart/form-data" in content_type:
            # To jest przesłanie audio z frontendu
            form_data = await request.form()
            audio = form_data.get("audio")
            webhook_url = form_data.get("webhook_url")
            
            if not audio or not webhook_url:
                raise HTTPException(status_code=400, detail="Brak audio lub webhook_url")
            
            # Przetwórz jako przesłanie audio (podobnie jak transcribe_endpoint)
            transcription_result = await transcribe_service.transcribe_audio(audio)
            transcribed_text = transcription_result["text"]
            
            # Wyślij do webhooka n8n
            n8n_response = await webhook_service.send_to_n8n(webhook_url, {"transcription": transcribed_text})
            
            # Zapisz odpowiedź w sesji
            if isinstance(n8n_response, dict) and "text" in n8n_response:
                session_storage.update_n8n_response(session_id, n8n_response)
            
            response_data = {
                "success": True,
                "text": transcribed_text,
                "n8nResponse": n8n_response if isinstance(n8n_response, dict) else None
            }
            
            response = JSONResponse(content=response_data)
            response.set_cookie(key="session_id", value=session_id, httponly=True, samesite="lax")
            return response
            
        else:
            # To jest odpowiedź tekstowa z n8n
            body = await request.json()
            
            if "text" not in body:
                raise HTTPException(status_code=400, detail="Brak pola 'text' w ciele żądania")
            
            # Zapisz jako ostatnią odpowiedź n8n
            n8n_response = {"text": body["text"]}
            session_storage.update_n8n_response(session_id, n8n_response)
            
            # Konwertuj tekst na mowę
            audio_path = await tts_service.text_to_speech(body["text"])
            
            # Zapisz ścieżkę pliku TTS
            session_storage.update_tts_file_path(session_id, audio_path)
            
            # Utwórz unikalny URL audio z ścieżki pliku
            audio_url = f"/api/audio/{os.path.basename(audio_path)}"
            
            # Zwróć JSON z tekstem i URL audio
            response = JSONResponse(content={
                "text": body["text"],
                "audio_url": audio_url
            })
            response.set_cookie(key="session_id", value=session_id, httponly=True, samesite="lax")
            return response
    
    except Exception as e:
        logger.error(f"Błąd przetwarzania żądania webhook: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# Endpoint stanu zdrowia
@app.get("/api/health")
async def health_check():
    """
    Endpoint stanu zdrowia do weryfikacji, czy API działa
    """
    return {
        "status": "ok",
        "version": "1.0.0",
        "services": {
            "stt": "operational",
            "tts": "operational",
            "webhook": "operational"
        }
    }

# Zamontuj pliki statyczne dla frontendu
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

# Uruchom aplikację
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
