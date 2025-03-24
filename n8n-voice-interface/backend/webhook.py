import logging
import json
import aiohttp
from typing import Dict, Any, Optional, Union

# Konfiguracja loggera
logger = logging.getLogger(__name__)

class WebhookService:
    """
    Serwis do obsługi komunikacji z webhookami n8n.
    Używa asynchronicznych wywołań HTTP i lepszego przetwarzania odpowiedzi.
    """
    
    def __init__(self, app_version: str = "1.0.0"):
        """
        Inicjalizuje serwis Webhook
        
        Args:
            app_version: Wersja aplikacji do metadanych
        """
        self.app_version = app_version
        logger.info(f"Serwis Webhook zainicjowany (wersja aplikacji: {self.app_version})")
    
    async def send_to_n8n(self, webhook_url: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Wysyła dane do webhooka n8n i zwraca odpowiedź
        
        Args:
            webhook_url: URL webhooka n8n
            data: Dane do wysłania (zostaną przekonwertowane na JSON)
            
        Returns:
            Odpowiedź n8n jako słownik, z polem "text" zawierającym odpowiedź tekstową
            
        Raises:
            Exception: W przypadku błędu komunikacji
        """
        if not webhook_url:
            raise ValueError("URL webhooka nie może być pusty")
            
        try:
            logger.info(f"Wysyłanie danych do webhooka n8n: {webhook_url}")
            
            # Utwórz payload JSON
            payload = {
                "transcription": data.get("transcription", ""),
                "timestamp": data.get("timestamp", ""),
                "metadata": {
                    "source": "n8n-voice-interface",
                    "version": self.app_version
                }
            }
            
            # Ustaw nagłówki
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            
            # Wyślij żądanie asynchronicznie
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    webhook_url, 
                    data=json.dumps(payload),
                    headers=headers
                ) as response:
                    # Sprawdź odpowiedź
                    if response.status == 200:
                        response_text = await response.text()
                        logger.info(f"Webhook zakończony pomyślnie. Odpowiedź: {response_text[:100]}...")
                        
                        return await self._parse_response(response_text)
                    else:
                        error_text = await response.text()
                        logger.error(f"Webhook nie powiódł się z kodem {response.status}: {error_text}")
                        return {"text": f"Błąd komunikacji z n8n (kod {response.status})"}
        
        except Exception as e:
            logger.error(f"Błąd podczas wysyłania webhooka: {str(e)}", exc_info=True)
            return {"text": f"Błąd komunikacji z n8n: {str(e)}"}
    
    async def _parse_response(self, response_text: str) -> Dict[str, Any]:
        """
        Przetwarza odpowiedź z webhooka n8n na ustandaryzowany format
        
        Args:
            response_text: Tekst odpowiedzi z webhooka
            
        Returns:
            Słownik z polem "text" zawierającym odpowiedź tekstową
        """
        try:
            # Próbuj sparsować jako JSON
            response_json = json.loads(response_text)
            
            # Sprawdź, czy odpowiedź ma pole text
            if isinstance(response_json, dict) and "text" in response_json:
                return response_json
            
            # Próbuj wyodrębnić tekst z różnych formatów
            if isinstance(response_json, dict):
                # Sprawdź popularne pola
                for key in ["message", "response", "content", "result"]:
                    if key in response_json and isinstance(response_json[key], str):
                        return {"text": response_json[key]}
            
            # Jeśli odpowiedź to prosty string
            if isinstance(response_json, str):
                return {"text": response_json}
            
            # Jeśli nie możemy znaleźć pola tekstowego, użyj całej odpowiedzi
            return {"text": response_text}
            
        except json.JSONDecodeError:
            # Jeśli to nie JSON, użyj surowego tekstu
            return {"text": response_text}

# Utwórz instancję serwisu dla łatwego importu
webhook_service = WebhookService()

# Funkcja kompatybilności wstecznej
async def send_to_n8n(webhook_url: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Kompatybilność wsteczna z poprzednią wersją funkcji
    """
    return await webhook_service.send_to_n8n(webhook_url, data)
