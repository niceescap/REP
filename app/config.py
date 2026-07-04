# config.py
from pydantic_settings import BaseSettings
from pathlib import Path

class Settings(BaseSettings):
    # Auth
    SECRET_KEY: str = "500edb23d698f42e9bd3280e6c9798ef667ba26113e0e06364153df80141d2c5"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8h pour une journée d'événement

    # Stockage
    STORAGE_ROOT: Path = Path("data/storage")

    # Ollama
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5:3b"

    # SQLite
    DB_PATH: str = "data/rep.db"

    class Config:
        env_file = ".env"

settings = Settings()

# Création du dossier storage au démarrage si absent
settings.STORAGE_ROOT.mkdir(exist_ok=True)
