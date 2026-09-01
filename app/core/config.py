import os
from typing import Optional
from pydantic import BaseSettings

is_vercel = bool(os.environ.get("VERCEL"))
default_storage_base = "/tmp/storage" if is_vercel else "./storage"

class Settings(BaseSettings):
    APP_NAME: str = "PlanilhaAT-Backend"
    APP_ENV: str = "production" if is_vercel else "development"
    DEBUG: bool = not is_vercel

    # Recursos inseguros de conveniência devem ser habilitados explicitamente.
    ENABLE_LOCAL_AUTH: bool = False
    AUTO_CREATE_SCHEMA: bool = False
    SEED_DEFAULTS: bool = False
    
    # Database (SQLite default or PostgreSQL from Supabase)
    DATABASE_URL: str = "sqlite:///./planilha_at.db"
    
    # Supabase Integration
    SUPABASE_URL: Optional[str] = None
    SUPABASE_KEY: Optional[str] = None
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None
    SUPABASE_JWT_SECRET: Optional[str] = None
    SUPABASE_STORAGE_BUCKET_TEMPLATES: str = "templates"
    SUPABASE_STORAGE_BUCKET_OUTPUTS: str = "outputs"

    # HTTP / uploads
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    MAX_UPLOAD_FILE_BYTES: int = 20 * 1024 * 1024
    MAX_UPLOAD_TOTAL_BYTES: int = 100 * 1024 * 1024
    MAX_ZIP_ENTRIES: int = 1000
    MAX_ZIP_UNCOMPRESSED_BYTES: int = 100 * 1024 * 1024
    MAX_ZIP_COMPRESSION_RATIO: int = 100
    
    # Storage Directories (Local fallback / Hybrid storage / Vercel tmp)
    STORAGE_DIR: str = default_storage_base
    TEMPLATES_DIR: str = os.path.join(default_storage_base, "templates")
    OUTPUTS_DIR: str = os.path.join(default_storage_base, "outputs")
    UPLOADS_DIR: str = os.path.join(default_storage_base, "uploads")
    BUNDLED_TEMPLATES_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "storage", "templates")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def local_auth_enabled(self) -> bool:
        return self.ENABLE_LOCAL_AUTH and self.DEBUG and self.APP_ENV.lower() in {
            "development",
            "test",
            "testing",
        }

settings = Settings()

# Ensure local storage directories exist safely
try:
    for d in [settings.STORAGE_DIR, settings.TEMPLATES_DIR, settings.OUTPUTS_DIR, settings.UPLOADS_DIR]:
        os.makedirs(d, exist_ok=True)
except Exception:
    pass
