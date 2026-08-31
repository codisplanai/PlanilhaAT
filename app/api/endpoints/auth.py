import secrets
import httpx
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Header, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import ACTIVE_DEV_TOKENS, LOCAL_USERS_FALLBACK, get_current_user as security_get_current_user
from app.models.profile import Profile
from app.schemas.auth import LoginRequest, TokenResponse, UserOut

router = APIRouter(prefix="/auth", tags=["Autenticação"])

# Usuários autorizados locais (fallback / dev / demonstração)
USERS_DB = {
    "admin@contabilidade.com": {
        "id": "00000000-0000-0000-0000-000000000001",
        "nome": "Contador Responsável",
        "email": "admin@contabilidade.com",
        "password": "admin",
        "cargo": "Contador Sênior",
        "role": "admin"
    },
    "operador@contabilidade.com": {
        "id": "00000000-0000-0000-0000-000000000002",
        "nome": "Operador Fiscal",
        "email": "operador@contabilidade.com",
        "password": "fiscal",
        "cargo": "Analista Fiscal",
        "role": "operador"
    }
}


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()

    # 1. Tentar autenticação via Supabase Auth se configurado
    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            auth_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/token?grant_type=password"
            headers = {
                "apikey": settings.SUPABASE_KEY,
                "Content-Type": "application/json"
            }
            with httpx.Client(timeout=5.0) as client:
                res = client.post(auth_url, json={"email": email, "password": payload.password}, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    access_token = data.get("access_token")
                    sb_user = data.get("user", {})
                    sb_user_id = sb_user.get("id")
                    sb_metadata = sb_user.get("user_metadata", {})

                    # Obter ou criar perfil no banco de dados
                    profile = db.query(Profile).filter(Profile.id == str(sb_user_id)).first()
                    if not profile:
                        cargo = sb_metadata.get("cargo", "Contador Sênior" if (email == "admin@contabilidade.com" or email == "admin@codisplan.com") else "Analista Fiscal")
                        role = sb_metadata.get("role", "admin" if (email == "admin@contabilidade.com" or email == "admin@codisplan.com" or cargo == "Contador Sênior") else "operador")
                        nome = sb_metadata.get("nome", email.split("@")[0])

                        profile = Profile(
                            id=str(sb_user_id),
                            email=email,
                            nome=nome,
                            cargo=cargo,
                            role=role
                        )
                        db.add(profile)
                        db.commit()
                        db.refresh(profile)

                    return TokenResponse(
                        access_token=access_token,
                        token_type="bearer",
                        user=UserOut(
                            id=profile.id,
                            nome=profile.nome,
                            email=profile.email,
                            cargo=profile.cargo,
                            role=profile.role
                        )
                    )
        except Exception:
            # Se falhar conexão com Supabase, faz fallback para banco local
            pass

    # 2. Fallback de autenticação local (desenvolvimento / teste / admin padrão)
    user = USERS_DB.get(email)
    if not user or user["password"] != payload.password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="E-mail ou senha incorretos. Verifique suas credenciais de acesso."
        )

    # Sincronizar com tabela profiles
    user_id = str(user["id"])
    profile = db.query(Profile).filter(Profile.id == user_id).first()
    if not profile:
        profile = Profile(
            id=user_id,
            email=user["email"],
            nome=user["nome"],
            cargo=user["cargo"],
            role=user.get("role", "operador")
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)

    # Gerar token de sessão seguro
    token = f"pat_{secrets.token_hex(24)}"
    ACTIVE_DEV_TOKENS[token] = {
        "id": profile.id,
        "email": profile.email,
        "nome": profile.nome,
        "cargo": profile.cargo,
        "role": profile.role
    }

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserOut(
            id=profile.id,
            nome=profile.nome,
            email=profile.email,
            cargo=profile.cargo,
            role=profile.role
        )
    )


@router.get("/me", response_model=UserOut)
def get_current_user(current_user: Profile = Depends(security_get_current_user)):
    return UserOut(
        id=current_user.id,
        nome=current_user.nome,
        email=current_user.email,
        cargo=current_user.cargo,
        role=current_user.role
    )
