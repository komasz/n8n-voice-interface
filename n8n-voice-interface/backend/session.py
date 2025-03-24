import logging
import uuid
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class SessionStorage:
    """
    Klasa zarządzająca stanem sesji dla różnych użytkowników.
    Rozwiązuje problem zmiennych globalnych w aplikacji wieloużytkownikowej.
    """
    
    def __init__(self):
        self.sessions: Dict[str, Dict[str, Any]] = {}
    
    def get_session(self, session_id: str) -> Dict[str, Any]:
        """
        Pobiera lub tworzy sesję dla danego identyfikatora
        
        Args:
            session_id: Unikalny identyfikator sesji
            
        Returns:
            Słownik zawierający dane sesji
        """
        if session_id not in self.sessions:
            self.sessions[session_id] = {
                'last_n8n_response': None,
                'last_tts_file_path': None
            }
            logger.info(f"Utworzono nową sesję: {session_id}")
        return self.sessions[session_id]
    
    def get_or_create_session_id(self, current_id: Optional[str] = None) -> str:
        """
        Generuje nowe ID sesji lub zwraca istniejące
        
        Args:
            current_id: Aktualne ID sesji (jeśli istnieje)
            
        Returns:
            ID sesji (nowe lub istniejące)
        """
        if not current_id:
            session_id = str(uuid.uuid4())
            self.get_session(session_id)  # Inicjalizacja nowej sesji
            return session_id
        return current_id
    
    def update_n8n_response(self, session_id: str, response: Dict[str, Any]) -> None:
        """Aktualizuje ostatnią odpowiedź n8n dla sesji"""
        session = self.get_session(session_id)
        session['last_n8n_response'] = response
        logger.info(f"Zaktualizowano odpowiedź n8n dla sesji: {session_id}")
    
    def update_tts_file_path(self, session_id: str, file_path: str) -> None:
        """Aktualizuje ścieżkę do ostatniego pliku TTS dla sesji"""
        session = self.get_session(session_id)
        session['last_tts_file_path'] = file_path
        logger.info(f"Zaktualizowano ścieżkę pliku TTS dla sesji: {session_id}")
    
    def get_n8n_response(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Pobiera ostatnią odpowiedź n8n dla sesji"""
        session = self.get_session(session_id)
        return session['last_n8n_response']
    
    def get_tts_file_path(self, session_id: str) -> Optional[str]:
        """Pobiera ścieżkę do ostatniego pliku TTS dla sesji"""
        session = self.get_session(session_id)
        return session['last_tts_file_path']
    
    def clean_old_sessions(self, max_sessions: int = 1000) -> None:
        """
        Czyści stare sesje, jeśli jest ich zbyt wiele
        
        Args:
            max_sessions: Maksymalna liczba sesji do przechowywania
        """
        if len(self.sessions) > max_sessions:
            # Usuń najstarsze sesje (first in, first out)
            sessions_to_remove = len(self.sessions) - max_sessions
            for _ in range(sessions_to_remove):
                if self.sessions:
                    oldest_session = next(iter(self.sessions))
                    del self.sessions[oldest_session]
            logger.info(f"Wyczyszczono {sessions_to_remove} starych sesji")
