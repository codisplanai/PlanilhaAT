import os
from typing import Optional
from pydantic import BaseSettings

is_vercel = bool(os.environ.get("VERCEL"))
default_storage_base = "/tmp/storage" if is_vercel else "./storage"

class Settings(BaseSettings):
    APP_NAME: str = "PlanilhaAT-Backend"
    APP_ENV: str = "production" if is_vercel else "development"
    DEBUG: bool = not is_vercel
    
    # Database (SQLite default or PostgreSQL from Supabase)
    DATABASE_URL: str = "sqlite:///./planilha_at.db"
    
    # Supabase Integration
    SUPABASE_URL: Optional[str] = None
    SUPABASE_KEY: Optional[str] = None
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None
    SUPABASE_JWT_SECRET: Optional[str] = None
    SUPABASE_STORAGE_BUCKET_TEMPLATES: str = "templates"
    SUPABASE_STORAGE_BUCKET_OUTPUTS: str = "outputs"
    
    # Storage Directories (Local fallback / Hybrid storage / Vercel tmp)
    STORAGE_DIR: str = default_storage_base
    TEMPLATES_DIR: str = os.path.join(default_storage_base, "templates")
    OUTPUTS_DIR: str = os.path.join(default_storage_base, "outputs")
    UPLOADS_DIR: str = os.path.join(default_storage_base, "uploads")
    BUNDLED_TEMPLATES_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "storage", "templates")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()

# Ensure local storage directories exist safely
try:
    for d in [settings.STORAGE_DIR, settings.TEMPLATES_DIR, settings.OUTPUTS_DIR, settings.UPLOADS_DIR]:
        os.makedirs(d, exist_ok=True)
except Exception:
    pass
