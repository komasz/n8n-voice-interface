import os
import logging
import uuid
import tempfile
import requests
from fastapi import UploadFile, HTTPException

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Constants
STT_MODEL = os.getenv("STT_MODEL", "whisper-1")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
API_URL = "https://api.openai.com/v1/audio/transcriptions"

async def transcribe_audio(audio_file: UploadFile) -> dict:
    """
    Transcribe audio using OpenAI's API.
    
    Args:
        audio_file: The uploaded audio file
    
    Returns:
        A dictionary containing the transcription text
    """
    if not OPENAI_API_KEY:
        logger.error("OpenAI API key not found in environment")
        raise HTTPException(
            status_code=500, 
            detail="OPENAI_API_KEY environment variable not set"
        )
    logger.info("OpenAI API key found in environment")

    try:
        # Save the uploaded file to a temporary location
        temp_dir = tempfile.gettempdir()
        temp_file_path = os.path.join(temp_dir, f"{uuid.uuid4()}_{audio_file.filename}")

        with open(temp_file_path, "wb") as temp_file:
            # Read the file in chunks
            content = await audio_file.read()
            temp_file.write(content)

        logger.info(f"Saved audio to temporary file: {temp_file_path}")

        # Set up the request headers
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}"
        }

        # Prepare the file and form data
        with open(temp_file_path, "rb") as file:
            # Set explicit MIME type to audio/mpeg as a safe default
            files = {
                "file": (os.path.basename(temp_file_path), file, "audio/mpeg"),
                "model": (None, STT_MODEL),
                "language": (None, "pl")  # Force Polish language recognition
            }
            
            # Make the API request
            logger.info(f"Sending request to OpenAI API using model: {STT_MODEL} with language: pl")
            response = requests.post(
                API_URL,
                headers=headers,
                files=files
            )

        # Clean up temporary file
        try:
            os.remove(temp_file_path)
            logger.info(f"Removed temporary file: {temp_file_path}")
        except Exception as e:
            logger.warning(f"Failed to remove temporary file: {str(e)}")

        # Check for errors
        if response.status_code != 200:
            logger.error(f"OpenAI API error: {response.status_code} - {response.text}")

            # Attempt to parse the error
            error_msg = "Transcription failed"
            try:
                error_data = response.json()
                if "error" in error_data and "message" in error_data["error"]:
                    error_msg = error_data["error"]["message"]
            except:
                pass

            raise HTTPException(status_code=500, detail=error_msg)

        # Parse the response
        result = response.json()
        logger.info(f"Transcription successful: {result.get('text', '')[:50]}...")

        return result

    except Exception as e:
        if isinstance(e, HTTPException):
            raise

        logger.error(f"Error during transcription: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")
