"""Autenticação e autorização centralizadas.

Perfis e permissões são sempre lidos do banco. Metadados editáveis do token
servem apenas para sugerir um nome na primeira autenticação e nunca concedem
privilégios.
"""

import logging
from typing import Any, Dict, Optional

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.profile import Profile

logger = logging.getLogger(__name__)

LOCAL_USERS_FALLBACK = {
    "admin@contabilidade.com": {
        "id": "184e793c-50b7-4b57-ace1-c02b19649408",
        "nome": "Contador Responsável",
        "email": "admin@contabilidade.com",
        "cargo": "Contador Sênior",
        "role": "admin",
    },
    "admin@codisplan.com": {
        "id": "184e793c-50b7-4b57-ace1-c02b19649408",
        "nome": "Contador Responsável",
        "email": "admin@codisplan.com",
        "cargo": "Contador Sênior",
        "role": "admin",
    },
    "operador@contabilidade.com": {
        "id": "00000000-0000-0000-0000-000000000002",
        "nome": "Operador Fiscal",
        "email": "operador@contabilidade.com",
        "cargo": "Analista Fiscal",
        "role": "operador",
    },
}

# Somente para desenvolvimento/testes explícitos. Tokens não reconhecidos
# nunca recebem permissão, ainda que usem o prefixo local.
ACTIVE_DEV_TOKENS: Dict[str, Dict[str, Any]] = {}


def verify_supabase_token(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None

    if settings.SUPABASE_JWT_SECRET:
        try:
            return jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        except jwt.PyJWTError:
            # A confirmação remota abaixo também suporta configurações de
            # assinatura mais novas do Supabase.
            pass

    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            headers = {
                "apikey": settings.SUPABASE_KEY,
                "Authorization": f"Bearer {token}",
            }
            url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user"
            with httpx.Client(timeout=8.0) as client:
                response = client.get(url, headers=headers)
            if response.status_code == 200:
                data = response.json()
                return {
                    "sub": data.get("id"),
                    "email": data.get("email"),
                    "user_metadata": data.get("user_metadata") or {},
                }
        except (httpx.HTTPError, ValueError):
            logger.warning("Falha ao validar token no Supabase", exc_info=True)

    return None


def _unauthorized(detail: str = "Sessão expirada ou token inválido. Faça login novamente.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _load_active_profile(db: Session, user_id: str) -> Profile:
    profile = db.query(Profile).filter(Profile.id == user_id).first()
    if not profile:
        if settings.local_auth_enabled:
            for fallback in LOCAL_USERS_FALLBACK.values():
                if str(fallback["id"]) == str(user_id):
                    return Profile(
                        id=str(fallback["id"]),
                        email=fallback["email"],
                        nome=fallback["nome"],
                        cargo=fallback["cargo"],
                        role=fallback["role"],
                        ativo=True,
                    )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário autenticado sem perfil autorizado no sistema.",
        )
    if not profile.ativo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta de usuário inativa. Contate o administrador.",
        )
    return profile


def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Profile:
    if not authorization or not authorization.startswith("Bearer "):
        raise _unauthorized("Token de autorização não fornecido ou formato inválido.")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise _unauthorized()

    if settings.local_auth_enabled and token in ACTIVE_DEV_TOKENS:
        return _load_active_profile(db, str(ACTIVE_DEV_TOKENS[token]["id"]))

    payload = verify_supabase_token(token)
    if not payload or not payload.get("sub"):
        raise _unauthorized()

    return _load_active_profile(db, str(payload["sub"]))


def get_optional_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Optional[Profile]:
    """Compatibilidade para fluxos realmente públicos; token inválido falha."""
    if not authorization:
        return None
    return get_current_user(authorization=authorization, db=db)


def require_admin(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Profile:
    current_user = get_current_user(authorization=authorization, db=db)
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito. Esta funcionalidade é exclusiva para o Contador Sênior / Administrador.",
        )
    return current_user
