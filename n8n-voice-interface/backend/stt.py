import os
import logging
import uuid
import tempfile
import aiohttp
from typing import Dict, Any, Optional
from fastapi import UploadFile, HTTPException

# Konfiguracja loggera
logger = logging.getLogger(__name__)

# Stałe
STT_MODEL = os.getenv("STT_MODEL", "whisper-1")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
API_URL = "https://api.openai.com/v1/audio/transcriptions"

async def transcribe_audio(audio_file: UploadFile) -> Dict[str, Any]:
    """
    Transkrybuje dźwięk używając API OpenAI
    
    Args:
        audio_file: Przesłany plik dźwiękowy
        
    Returns:
        Słownik zawierający transkrypcję tekstową
        
    Raises:
        HTTPException: W przypadku błędu transkrypcji
    """
    if not OPENAI_API_KEY:
        logger.error("Nie znaleziono klucza API OpenAI w zmiennych środowiskowych")
        raise HTTPException(
            status_code=500, 
            detail="OPENAI_API_KEY environment variable not set"
        )
    logger.info("Klucz API OpenAI znaleziony w zmiennych środowiskowych")

    try:
        # Zapisz przesłany plik do lokalizacji tymczasowej
        temp_dir = tempfile.gettempdir()
        temp_file_path = os.path.join(temp_dir, f"{uuid.uuid4()}_{audio_file.filename}")

        with open(temp_file_path, "wb") as temp_file:
            # Odczytaj plik w całości
            content = await audio_file.read()
            temp_file.write(content)

        logger.info(f"Zapisano audio do pliku tymczasowego: {temp_file_path}")

        # Przygotuj nagłówki żądania
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}"
        }

        # Przygotuj plik i dane formularza
        try:
            async with aiohttp.ClientSession() as session:
                form = aiohttp.FormData()
                with open(temp_file_path, "rb") as file:
                    form.add_field(
                        'file', 
                        file, 
                        filename=os.path.basename(temp_file_path),
                        content_type='audio/mpeg'
                    )
                    form.add_field('model', STT_MODEL)
                    form.add_field('language', 'pl')  # Wymuś rozpoznawanie języka polskiego
                
                # Wyślij żądanie API
                logger.info(f"Wysyłanie żądania do API OpenAI używając modelu: {STT_MODEL} z językiem: pl")
                async with session.post(API_URL, headers=headers, data=form) as response:
                    # Sprawdź, czy wystąpiły błędy
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Błąd API OpenAI: {response.status} - {error_text}")

                        # Próba analizy błędu
                        error_msg = "Transkrypcja nie powiodła się"
                        try:
                            error_data = await response.json()
                            if "error" in error_data and "message" in error_data["error"]:
                                error_msg = error_data["error"]["message"]
                        except:
                            pass

                        raise HTTPException(status_code=500, detail=error_msg)

                    # Sparsuj odpowiedź
                    result = await response.json()
                    logger.info(f"Transkrypcja zakończona pomyślnie: {result.get('text', '')[:50]}...")
                    return result

        finally:
            # Wyczyść plik tymczasowy
            try:
                os.remove(temp_file_path)
                logger.info(f"Usunięto plik tymczasowy: {temp_file_path}")
            except Exception as e:
                logger.warning(f"Nie udało się usunąć pliku tymczasowego: {str(e)}")

    except Exception as e:
        if isinstance(e, HTTPException):
            raise

        logger.error(f"Błąd podczas transkrypcji: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Błąd transkrypcji: {str(e)}")
