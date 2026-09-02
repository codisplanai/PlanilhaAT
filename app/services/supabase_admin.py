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
            # Um 200 com corpo não-JSON (gateway interpondo HTML) não pode
            # escapar como ValueError: o endpoint só compensa a criação quando
            # recebe HTTPException, e a conta já existe neste ponto.
            try:
                corpo = response.json()
            except ValueError:
                corpo = None
            user_id = corpo.get("id") if isinstance(corpo, dict) else None
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
                response = client.delete(
                    f"{cls._base_url()}/{user_id}", headers=cls._get_headers()
                )
        except httpx.HTTPError:
            logger.exception("Falha ao remover usuário %s no Supabase Auth", user_id)
            return

        # 404 significa que a conta já não existe — o objetivo da compensação.
        # Qualquer outro erro (401 de key rotacionada, 403) devolve normalmente
        # do httpx e passaria em silêncio, deixando a conta órfã: sem linha em
        # profiles e com o e-mail bloqueado pelo UNIQUE para sempre.
        if response.status_code >= 400 and response.status_code != 404:
            logger.warning(
                "Supabase Auth recusou a remoção do usuário %s (HTTP %s). "
                "A conta pode ter ficado órfã, sem perfil correspondente.",
                user_id,
                response.status_code,
            )

    @classmethod
    def update_password(cls, user_id: str, new_password: str) -> None:
        if not cls.is_configured():
            raise SupabaseAdminNaoConfigurado()

        payload = {"password": new_password}
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.put(
                    f"{cls._base_url()}/{user_id}", json=payload, headers=cls._get_headers()
                )
        except httpx.HTTPError as exc:
            logger.warning("Supabase Auth indisponível ao atualizar senha: %s", exc)
            raise HTTPException(
                status_code=503,
                detail="Serviço de autenticação temporariamente indisponível.",
            )

        if response.status_code not in (200, 201):
            if response.status_code >= 500:
                raise HTTPException(
                    status_code=503,
                    detail="Serviço de autenticação temporariamente indisponível.",
                )
            raise HTTPException(status_code=400, detail=cls._mensagem_de_erro(response))

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
