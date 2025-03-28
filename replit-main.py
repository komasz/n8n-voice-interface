"""
Replit entry point for N8N Voice Interface
"""
import os
import sys

# Add the current directory to the path so we can import from backend
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import and run the app
from backend.app import app
import uvicorn

if __name__ == "__main__":
    # Get port from environment (Replit sets this)
    port = int(os.environ.get("PORT", 8080))
    
    # Run the application
    uvicorn.run(
        "backend.app:app", 
        host="0.0.0.0", 
        port=port,
        reload=False
    )
