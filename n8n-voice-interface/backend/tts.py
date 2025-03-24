import os
import logging
import aiohttp
from typing import Dict, Any, Optional

from backend.utils.file_manager import FileManager

# Konfiguracja loggera
logger = logging.getLogger(__name__)

class TextToSpeechService:
    """
    Serwis do konwersji tekstu na mowę przy użyciu API OpenAI.
    Używa asynchronicznych wywołań HTTP i lepszego zarządzania plikami.
    """
    
    def __init__(
        self, 
        api_key: Optional[str] = None, 
        model: Optional[str] = None,
        voice: str = "ash",
        language: str = "pl",
        instructions: Optional[str] = None
    ):
        """
        Inicjalizuje serwis TTS
        
        Args:
            api_key: Klucz API OpenAI (domyślnie z zmiennej środowiskowej)
            model: Model TTS do użycia (domyślnie z zmiennej środowiskowej lub "gpt-4o-mini-tts")
            voice: Głos do użycia (domyślnie "ash")
            language: Język wypowiedzi (domyślnie "pl" - polski)
            instructions: Dodatkowe instrukcje dla API (domyślnie instrukcje dotyczące polskiego języka)
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.model = model or os.getenv("TTS_MODEL", "gpt-4o-mini-tts")
        self.voice = voice
        self.language = language
        self.instructions = instructions or "Mów po polsku z polskim akcentem. Speak in Polish language with a natural Polish accent."
        self.api_url = "https://api.openai.com/v1/audio/speech"
        
        if not self.api_key:
            logger.error("Nie znaleziono klucza API OpenAI w zmiennych środowiskowych")
            raise ValueError("OPENAI_API_KEY nie jest ustawiony. Ustaw zmienną środowiskową OPENAI_API_KEY.")
            
        logger.info(f"Serwis TTS zainicjowany z modelem: {self.model}, głos: {self.voice}, język: {self.language}")
    
    async def text_to_speech(self, text: str) -> str:
        """
        Konwertuje tekst na mowę używając API OpenAI
        
        Args:
            text: Tekst do zamiany na mowę
            
        Returns:
            Ścieżka do pliku audio
            
        Raises:
            Exception: W przypadku błędu konwersji
        """
        if not text:
            raise ValueError("Tekst do konwersji nie może być pusty")
        
        try:
            # Przygotuj nagłówki i dane
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": self.model,
                "voice": self.voice,
                "input": text,
                "instructions": self.instructions,
            }
            
            # Użyj aiohttp zamiast synchronicznego requests
            async with aiohttp.ClientSession() as session:
                logger.info(f"Wysyłanie żądania do API OpenAI TTS (model: {self.model}, głos: {self.voice})")
                async with session.post(self.api_url, headers=headers, json=payload) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Błąd API OpenAI TTS: {response.status} - {error_text}")
                        raise Exception(f"Konwersja TTS nie powiodła się: {error_text}")
                    
                    # Pobierz zawartość binarną
                    audio_content = await response.read()
                    
                    # Zapisz do pliku tymczasowego
                    output_file = await FileManager.save_bytes_to_temp_file(
                        audio_content,
                        prefix="tts",
                        suffix=".mp3"
                    )
                    
            logger.info(f"Konwersja TTS zakończona pomyślnie: {output_file}")
            return output_file
                
        except Exception as e:
            logger.error(f"Błąd podczas konwersji tekstu na mowę: {str(e)}", exc_info=True)
            raise Exception(f"Błąd TTS: {str(e)}")
    
    async def get_tts_with_config(self, text: str, voice: Optional[str] = None, 
                                language: Optional[str] = None, 
                                instructions: Optional[str] = None) -> str:
        """
        Konwertuje tekst na mowę z niestandardową konfiguracją
        
        Args:
            text: Tekst do zamiany na mowę
            voice: Opcjonalny głos (zastępuje domyślny)
            language: Opcjonalny język (zastępuje domyślny)
            instructions: Opcjonalne instrukcje (zastępują domyślne)
            
        Returns:
            Ścieżka do pliku audio
        """
        # Tymczasowo zmień konfigurację
        original_voice = self.voice
        original_instructions = self.instructions
        
        try:
            if voice:
                self.voice = voice
            if instructions:
                self.instructions = instructions
                
            return await self.text_to_speech(text)
        finally:
            # Przywróć oryginalną konfigurację
            self.voice = original_voice
            self.instructions = original_instructions

# Utwórz instancję serwisu dla łatwego importu
tts_service = TextToSpeechService()

# Funkcja kompatybilności wstecznej
async def text_to_speech(text: str) -> str:
    """
    Kompatybilność wsteczna z poprzednią wersją funkcji
    """
    return await tts_service.text_to_speech(text)
