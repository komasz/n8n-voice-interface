import os
import logging
import aiohttp
from typing import Dict, Any, Optional
from fastapi import UploadFile, HTTPException

from backend.utils.file_manager import FileManager

# Konfiguracja loggera
logger = logging.getLogger(__name__)

class SpeechToTextService:
    """
    Serwis do transkrypcji mowy na tekst przy użyciu API OpenAI.
    Używa asynchronicznych wywołań HTTP i lepszego zarządzania plikami.
    """
    
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None, language: str = "pl"):
        """
        Inicjalizuje serwis STT
        
        Args:
            api_key: Klucz API OpenAI (domyślnie z zmiennej środowiskowej)
            model: Model STT do użycia (domyślnie z zmiennej środowiskowej lub "whisper-1")
            language: Język transkrypcji (domyślnie "pl" - polski)
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.model = model or os.getenv("STT_MODEL", "whisper-1")
        self.language = language
        self.api_url = "https://api.openai.com/v1/audio/transcriptions"
        
        if not self.api_key:
            logger.error("Nie znaleziono klucza API OpenAI w zmiennych środowiskowych")
            raise ValueError("OPENAI_API_KEY nie jest ustawiony. Ustaw zmienną środowiskową OPENAI_API_KEY.")
            
        logger.info(f"Serwis STT zainicjowany z modelem: {self.model}, język: {self.language}")
    
    async def transcribe_audio(self, audio_file: UploadFile) -> Dict[str, Any]:
        """
        Transkrybuje dźwięk używając asynchronicznych wywołań API OpenAI
        
        Args:
            audio_file: Przesłany plik dźwiękowy
            
        Returns:
            Słownik zawierający transkrypcję tekstową
            
        Raises:
            HTTPException: W przypadku błędu transkrypcji
        """
        try:
            # Zapisz plik tymczasowo
            temp_file_path = await FileManager.save_upload_to_temp_file(audio_file)
            
            try:
                # Przygotuj nagłówki
                headers = {
                    "Authorization": f"Bearer {self.api_key}"
                }
                
                # Użyj aiohttp zamiast synchronicznego requests
                async with aiohttp.ClientSession() as session:
                    form = aiohttp.FormData()
                    form.add_field(
                        'file',
                        open(temp_file_path, 'rb'),
                        filename=os.path.basename(temp_file_path),
                        content_type='audio/mpeg'
                    )
                    form.add_field('model', self.model)
                    form.add_field('language', self.language)
                    
                    logger.info(f"Wysyłanie żądania do API OpenAI (model: {self.model}, język: {self.language})")
                    async with session.post(self.api_url, headers=headers, data=form) as response:
                        if response.status != 200:
                            error_text = await response.text()
                            logger.error(f"Błąd API OpenAI: {response.status} - {error_text}")
                            
                            # Spróbuj wyodrębnić komunikat błędu
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
                await FileManager.cleanup_temp_file(temp_file_path)
                
        except Exception as e:
            if isinstance(e, HTTPException):
                raise
                
            logger.error(f"Błąd podczas transkrypcji: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Błąd transkrypcji: {str(e)}")

# Utwórz instancję serwisu dla łatwego importu
transcribe_service = SpeechToTextService()

# Funkcja kompatybilności wstecznej
async def transcribe_audio(audio_file: UploadFile) -> Dict[str, Any]:
    """
    Kompatybilność wsteczna z poprzednią wersją funkcji
    """
    return await transcribe_service.transcribe_audio(audio_file)
