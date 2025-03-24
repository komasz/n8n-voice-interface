import os
import logging
import requests
import tempfile
import uuid
from fastapi import UploadFile, HTTPException

# Konfiguracja loggera
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Stałe konfiguracyjne
STT_MODEL = os.getenv("STT_MODEL", "whisper-1")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
API_URL = "https://api.openai.com/v1/audio/transcriptions"

async def transcribe_audio(audio_file: UploadFile) -> dict:
    """
    Transkrybuje dźwięk używając API OpenAI.
    
    Args:
        audio_file: Przesłany plik dźwiękowy
        
    Returns:
        Słownik zawierający transkrypcję tekstową
    """
    # Sprawdź klucz API
    if not OPENAI_API_KEY:
        logger.error("Brak klucza API OpenAI w zmiennych środowiskowych")
        raise HTTPException(status_code=500, detail="Brak klucza API OpenAI (OPENAI_API_KEY)")
    
    # Zapisz plik tymczasowo
    temp_dir = tempfile.gettempdir()
    temp_file_path = os.path.join(temp_dir, f"audio_{uuid.uuid4()}.webm")
    
    try:
        # Zapisz przesłany plik
        with open(temp_file_path, "wb") as temp_file:
            content = await audio_file.read()
            temp_file.write(content)
        
        logger.info(f"Zapisano plik audio do: {temp_file_path}")
        
        # Konfiguracja żądania API
        headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
        
        with open(temp_file_path, "rb") as audio:
            files = {
                "file": ("audio.webm", audio, "audio/webm"),
                "model": (None, STT_MODEL),
                "language": (None, "pl")
            }
            
            # Wyślij żądanie do API OpenAI
            logger.info(f"Wysyłanie żądania do API OpenAI (model: {STT_MODEL})")
            response = requests.post(API_URL, headers=headers, files=files)
        
        # Usuń plik tymczasowy
        try:
            os.remove(temp_file_path)
            logger.info(f"Usunięto plik tymczasowy: {temp_file_path}")
        except Exception as e:
            logger.warning(f"Nie można usunąć pliku tymczasowego: {e}")
        
        # Sprawdź odpowiedź
        if response.status_code != 200:
            logger.error(f"Błąd API OpenAI ({response.status_code}): {response.text}")
            raise HTTPException(status_code=500, detail=f"Błąd API OpenAI: {response.text}")
        
        # Zwróć wynik
        result = response.json()
        logger.info(f"Transkrypcja zakończona pomyślnie: {result.get('text', '')[:50]}...")
        return result
        
    except Exception as e:
        # Usuń plik tymczasowy w przypadku błędu
        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        except:
            pass
        
        logger.error(f"Wystąpił błąd podczas transkrypcji: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Błąd transkrypcji: {str(e)}")
