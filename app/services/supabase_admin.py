"""Wrapper da Admin API do Supabase Auth.

Isolar a dependência HTTP aqui permite que os testes de endpoint mockem este
módulo em vez de remendar ``httpx`` dentro do endpoint.
"""

import logging
from typing import Dict

import httpx
from fastapi import HTTPException

from app.core.config import settings

logger = logging.getLogger(__name__)


class SupabaseAdminNaoConfigurado(RuntimeError):
    """SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes."""


class SupabaseAdminService:
    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY)

    @classmethod
    def _get_headers(cls) -> Dict[str, str]:
        key = settings.SUPABASE_SERVICE_ROLE_KEY
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    @classmethod
    def _base_url(cls) -> str:
        return f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/admin/users"

    @classmethod
    def create_user(cls, email: str, password: str, nome: str) -> str:
        if not cls.is_configured():
            raise SupabaseAdminNaoConfigurado()

        payload = {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"nome": nome},
        }
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.post(
                    cls._base_url(), json=payload, headers=cls._get_headers()
                )
        except httpx.HTTPError as exc:
            logger.warning("Supabase Auth indisponível ao criar usuário: %s", exc)
            raise HTTPException(
                status_code=503,
                detail="Serviço de autenticação temporariamente indisponível.",
            )

        if response.status_code in (200, 201):
            user_id = (response.json() or {}).get("id")
            if not user_id:
                raise HTTPException(
                    status_code=502,
                    detail="Resposta inválida do serviço de autenticação.",
                )
            return str(user_id)

        if response.status_code >= 500:
            raise HTTPException(
                status_code=503,
                detail="Serviço de autenticação temporariamente indisponível.",
            )

        raise HTTPException(status_code=400, detail=cls._mensagem_de_erro(response))

    @classmethod
    def delete_user(cls, user_id: str) -> None:
        """Usado apenas na compensação; nunca propaga erro para não mascarar a falha original."""
        if not cls.is_configured():
            return
        try:
            with httpx.Client(timeout=15.0) as client:
                client.delete(
                    f"{cls._base_url()}/{user_id}", headers=cls._get_headers()
                )
        except httpx.HTTPError:
            logger.exception("Falha ao remover usuário %s no Supabase Auth", user_id)

    @staticmethod
    def _mensagem_de_erro(response: httpx.Response) -> str:
        generica = "Não foi possível criar o usuário no serviço de autenticação."
        try:
            corpo = response.json() or {}
        except ValueError:
            return generica
        return str(
            corpo.get("msg")
            or corpo.get("error_description")
            or corpo.get("message")
            or generica
        )
