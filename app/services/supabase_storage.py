import os
import httpx
from typing import Optional, Tuple
from app.core.config import settings

class SupabaseStorageService:
    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.SUPABASE_URL and (settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY))

    @classmethod
    def _get_headers(cls) -> dict:
        key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}"
        }

    @classmethod
    def upload_file(
        cls,
        bucket: str,
        path: str,
        file_bytes: bytes,
        content_type: str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) -> bool:
        """Faz upload de um arquivo para o Supabase Storage."""
        if not cls.is_configured():
            return False

        try:
            url = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/{bucket}/{path}"
            headers = cls._get_headers()
            headers["Content-Type"] = content_type
            headers["x-upsert"] = "true"

            with httpx.Client(timeout=15.0) as client:
                res = client.post(url, content=file_bytes, headers=headers)
                return res.status_code in [200, 201]
        except Exception:
            return False

    @classmethod
    def download_file(cls, bucket: str, path: str) -> Optional[bytes]:
        """Baixa um arquivo do Supabase Storage."""
        if not cls.is_configured():
            return None

        try:
            url = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/authenticated/{bucket}/{path}"
            headers = cls._get_headers()
            with httpx.Client(timeout=15.0) as client:
                res = client.get(url, headers=headers)
                if res.status_code == 200:
                    return res.content
        except Exception:
            pass
        return None
