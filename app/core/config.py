import os
from typing import Optional
from pydantic import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "PlanilhaAT-Backend"
    APP_ENV: str = "development"
    DEBUG: bool = True
    
    # Database (SQLite default or PostgreSQL from Supabase)
    DATABASE_URL: str = "sqlite:///./planilha_at.db"
    
    # Supabase Integration
    SUPABASE_URL: Optional[str] = None
    SUPABASE_KEY: Optional[str] = None
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None
    SUPABASE_JWT_SECRET: Optional[str] = None
    SUPABASE_STORAGE_BUCKET_TEMPLATES: str = "templates"
    SUPABASE_STORAGE_BUCKET_OUTPUTS: str = "outputs"
    
    # Storage Directories (Local fallback / Hybrid storage)
    STORAGE_DIR: str = "./storage"
    TEMPLATES_DIR: str = "./storage/templates"
    OUTPUTS_DIR: str = "./storage/outputs"
    UPLOADS_DIR: str = "./storage/uploads"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()

# Ensure local storage directories exist
for d in [settings.STORAGE_DIR, settings.TEMPLATES_DIR, settings.OUTPUTS_DIR, settings.UPLOADS_DIR]:
    os.makedirs(d, exist_ok=True)
