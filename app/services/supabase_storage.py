import logging
from urllib.parse import quote
import httpx
from typing import Optional
from app.core.config import settings

logger = logging.getLogger(__name__)

class SupabaseStorageService:
    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY)

    @classmethod
    def _get_headers(cls) -> dict:
        key = settings.SUPABASE_SERVICE_ROLE_KEY
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
            safe_bucket = quote(bucket, safe="")
            safe_path = quote(path.replace("\\", "/").lstrip("/"), safe="/")
            url = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/{safe_bucket}/{safe_path}"
            headers = cls._get_headers()
            headers["Content-Type"] = content_type
            headers["x-upsert"] = "true"

            with httpx.Client(timeout=15.0) as client:
                res = client.post(url, content=file_bytes, headers=headers)
                if res.status_code in [200, 201]:
                    return True
                logger.error("Upload no Supabase Storage falhou (%s): %s", res.status_code, res.text[:300])
        except httpx.HTTPError:
            logger.exception("Upload no Supabase Storage falhou")
            return False
        return False

    @classmethod
    def download_file(cls, bucket: str, path: str) -> Optional[bytes]:
        """Baixa um arquivo do Supabase Storage."""
        if not cls.is_configured():
            return None

        try:
            safe_bucket = quote(bucket, safe="")
            safe_path = quote(path.replace("\\", "/").lstrip("/"), safe="/")
            url = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/authenticated/{safe_bucket}/{safe_path}"
            headers = cls._get_headers()
            with httpx.Client(timeout=15.0) as client:
                res = client.get(url, headers=headers)
                if res.status_code == 200:
                    return res.content
                logger.warning("Download no Supabase Storage falhou (%s)", res.status_code)
        except httpx.HTTPError:
            logger.exception("Download no Supabase Storage falhou")
        return None

    @classmethod
    def delete_file(cls, bucket: str, path: str) -> bool:
        if not cls.is_configured():
            return False
        safe_bucket = quote(bucket, safe="")
        safe_path = quote(path.replace("\\", "/").lstrip("/"), safe="/")
        url = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/{safe_bucket}/{safe_path}"
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.delete(url, headers=cls._get_headers())
            if response.status_code in {200, 204, 404}:
                return True
            logger.error("Exclusão no Supabase Storage falhou (%s): %s", response.status_code, response.text[:300])
        except httpx.HTTPError:
            logger.exception("Exclusão no Supabase Storage falhou")
        return False
