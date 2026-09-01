import logging
import secrets
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import (
    ACTIVE_DEV_TOKENS,
    LOCAL_USERS_FALLBACK,
    get_current_user as security_get_current_user,
    known_account_profile,
    reconcile_known_account,
)
from app.models.profile import Profile
from app.schemas.auth import LoginRequest, TokenResponse, UserOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Autenticação"])

USERS_DB = {
    "admin@contabilidade.com": {
        **LOCAL_USERS_FALLBACK["admin@contabilidade.com"],
        "valid_passwords": {"admin", "123456", "fiscal", "admin123"},
        "password": "admin",
    },
    "admin@codisplan.com": {
        **LOCAL_USERS_FALLBACK["admin@codisplan.com"],
        "valid_passwords": {"admin", "codisplan", "123456", "fiscal", "admin123"},
        "password": "admin",
    },
    "operador@contabilidade.com": {
        **LOCAL_USERS_FALLBACK["operador@contabilidade.com"],
        "valid_passwords": {"fiscal", "operador", "admin", "123456"},
        "password": "fiscal",
    },
}


def _user_out(profile: Profile) -> UserOut:
    return UserOut(
        id=str(profile.id),
        nome=profile.nome,
        email=profile.email,
        cargo=profile.cargo,
        role=profile.role,
    )


def _ensure_local_profile(db: Session, user: dict) -> Profile:
    profile = db.query(Profile).filter(
        (Profile.id == str(user["id"])) | (Profile.email == user["email"])
    ).first()
    if not profile:
        profile = Profile(
            id=str(user["id"]),
            email=user["email"],
            nome=user["nome"],
            cargo=user["cargo"],
            role=user["role"],
            ativo=True,
        )
        try:
            db.add(profile)
            db.commit()
            db.refresh(profile)
        except Exception:
            db.rollback()
            logger.warning("Perfil mantido em memória para ambiente local de desenvolvimento")
            profile = Profile(
                id=str(user["id"]),
                email=user["email"],
                nome=user["nome"],
                cargo=user["cargo"],
                role=user["role"],
                ativo=True,
            )
    elif reconcile_known_account(profile):
        try:
            db.commit()
            db.refresh(profile)
        except Exception:
            db.rollback()
            logger.warning("Falha ao realinhar perfil institucional local", exc_info=True)
    if not profile.ativo:
        raise HTTPException(status_code=403, detail="Conta de usuário inativa.")
    return profile



@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()

    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        auth_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/token?grant_type=password"
        headers = {"apikey": settings.SUPABASE_KEY, "Content-Type": "application/json"}
        try:
            with httpx.Client(timeout=10.0) as client:
                response = client.post(
                    auth_url,
                    json={"email": email, "password": payload.password},
                    headers=headers,
                )
        except httpx.HTTPError as exc:
            logger.warning("Supabase Auth indisponível: %s", exc)
            if not settings.local_auth_enabled:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Serviço de autenticação temporariamente indisponível.",
                )
        else:
            if response.status_code == 200:
                data = response.json()
                sb_user = data.get("user") or {}
                user_id = sb_user.get("id")
                token = data.get("access_token")
                if not user_id or not token:
                    raise HTTPException(status_code=502, detail="Resposta inválida do serviço de autenticação.")

                profile = db.query(Profile).filter(Profile.id == str(user_id)).first()
                account = known_account_profile(email) or {}
                if not profile:
                    metadata = sb_user.get("user_metadata") or {}
                    nome = account.get("nome") or metadata.get("nome") or email.split("@", 1)[0]
                    profile = Profile(
                        id=str(user_id),
                        email=email,
                        nome=str(nome)[:255],
                        cargo=account.get("cargo", "Analista Fiscal"),
                        role=account.get("role", "operador"),
                    )
                    db.add(profile)
                    try:
                        db.commit()
                        db.refresh(profile)
                    except Exception:
                        db.rollback()
                        logger.exception("Falha ao provisionar perfil autenticado")
                        raise HTTPException(status_code=500, detail="Não foi possível preparar o usuário.")
                elif reconcile_known_account(profile):
                    try:
                        db.commit()
                        db.refresh(profile)
                    except Exception:
                        db.rollback()
                        logger.exception("Falha ao realinhar perfil institucional")

                if not profile.ativo:
                    raise HTTPException(status_code=403, detail="Conta de usuário inativa.")
                return TokenResponse(access_token=token, token_type="bearer", user=_user_out(profile))

            if not settings.local_auth_enabled:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="E-mail ou senha incorretos. Verifique suas credenciais de acesso.",
                )

    if not settings.local_auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Nenhum provedor de autenticação está disponível.",
        )

    user = USERS_DB.get(email)
    valid_passwords = user.get("valid_passwords", {user["password"]}) if user else set()
    if not user or not any(secrets.compare_digest(p, payload.password) for p in valid_passwords):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos. Verifique suas credenciais de acesso.")

    profile = _ensure_local_profile(db, user)
    token = f"pat_{secrets.token_hex(32)}"
    ACTIVE_DEV_TOKENS[token] = {"id": str(profile.id)}
    return TokenResponse(access_token=token, token_type="bearer", user=_user_out(profile))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        ACTIVE_DEV_TOKENS.pop(authorization.split(" ", 1)[1].strip(), None)
    return None


@router.get("/me", response_model=UserOut)
def get_current_user(current_user: Profile = Depends(security_get_current_user)):
    return _user_out(current_user)
