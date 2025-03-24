import os
import uuid
import logging
import tempfile
from typing import Callable, Any, Awaitable, TypeVar, Optional
from fastapi import UploadFile

logger = logging.getLogger(__name__)

T = TypeVar('T')

class FileManager:
    """
    Klasa zarządzająca plikami tymczasowymi w aplikacji.
    Zapewnia bezpieczne tworzenie, używanie i usuwanie plików tymczasowych.
    """
    
    @staticmethod
    async def save_upload_to_temp_file(upload_file: UploadFile) -> str:
        """
        Zapisuje plik przesłany przez użytkownika do pliku tymczasowego
        
        Args:
            upload_file: Plik przesłany przez użytkownika
            
        Returns:
            Ścieżka do pliku tymczasowego
        """
        temp_dir = tempfile.gettempdir()
        filename = f"{uuid.uuid4()}_{upload_file.filename if upload_file.filename else 'upload'}"
        file_path = os.path.join(temp_dir, filename)
        
        content = await upload_file.read()
        
        with open(file_path, "wb") as temp_file:
            temp_file.write(content)
            
        logger.info(f"Zapisano plik do: {file_path}")
        return file_path
    
    @staticmethod
    async def save_bytes_to_temp_file(content: bytes, prefix: str = "audio", suffix: str = ".mp3") -> str:
        """
        Zapisuje dane binarne do pliku tymczasowego
        
        Args:
            content: Dane binarne do zapisania
            prefix: Prefiks nazwy pliku
            suffix: Rozszerzenie pliku
            
        Returns:
            Ścieżka do pliku tymczasowego
        """
        temp_dir = tempfile.gettempdir()
        file_path = os.path.join(temp_dir, f"{prefix}_{uuid.uuid4()}{suffix}")
        
        with open(file_path, "wb") as temp_file:
            temp_file.write(content)
            
        logger.info(f"Zapisano dane do pliku tymczasowego: {file_path}")
        return file_path
    
    @staticmethod
    async def cleanup_temp_file(file_path: Optional[str]) -> None:
        """
        Usuwa plik tymczasowy
        
        Args:
            file_path: Ścieżka do pliku tymczasowego
        """
        if not file_path:
            return
            
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"Usunięto plik tymczasowy: {file_path}")
        except Exception as e:
            logger.warning(f"Nie udało się usunąć pliku tymczasowego {file_path}: {str(e)}")
    
    @staticmethod
    async def with_temp_file(content: bytes, callback: Callable[[str], Awaitable[T]], 
                             prefix: str = "audio", suffix: str = ".mp3") -> T:
        """
        Zapisuje dane do pliku tymczasowego, wywołuje callback z ścieżką do pliku,
        a następnie czyści plik niezależnie od tego, czy callback się powiódł czy nie.
        
        Args:
            content: Dane binarne do zapisania
            callback: Funkcja asynchroniczna do wywołania z ścieżką pliku
            prefix: Prefiks nazwy pliku
            suffix: Rozszerzenie pliku
            
        Returns:
            Wynik funkcji callback
        """
        file_path = await FileManager.save_bytes_to_temp_file(content, prefix, suffix)
        try:
            return await callback(file_path)
        finally:
            await FileManager.cleanup_temp_file(file_path)
