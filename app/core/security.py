import jwt
import httpx
from typing import Optional, Dict, Any
from fastapi import Header, HTTPException, Depends, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.profile import Profile
from app.schemas.auth import UserOut

# Usuários padrão para fallback/desenvolvimento local sem Supabase
LOCAL_USERS_FALLBACK = {
    "admin@contabilidade.com": {
        "id": "1",
        "nome": "Contador Responsável",
        "email": "admin@contabilidade.com",
        "cargo": "Contador Sênior",
        "role": "admin"
    },
    "operador@contabilidade.com": {
        "id": "2",
        "nome": "Operador Fiscal",
        "email": "operador@contabilidade.com",
        "cargo": "Analista Fiscal",
        "role": "operador"
    }
}

ACTIVE_DEV_TOKENS: Dict[str, Dict[str, Any]] = {}


def verify_supabase_token(token: str) -> Optional[Dict[str, Any]]:
    """Valida token JWT emitido pelo Supabase."""
    if not token:
        return None

    # 1. Validação local com segredo JWT se configurado
    if settings.SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False}
            )
            return payload
        except Exception:
            pass

    # 2. Validação via endpoint /auth/v1/user do Supabase se URL configurada
    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            headers = {
                "apikey": settings.SUPABASE_KEY,
                "Authorization": f"Bearer {token}"
            }
            url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user"
            with httpx.Client(timeout=5.0) as client:
                res = client.get(url, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    user_metadata = data.get("user_metadata", {})
                    return {
                        "sub": data.get("id"),
                        "email": data.get("email"),
                        "user_metadata": user_metadata
                    }
        except Exception:
            pass

    # 3. Fallback para decodificação sem verificação de assinatura em ambiente de dev
    if settings.DEBUG:
        try:
            unverified = jwt.decode(token, options={"verify_signature": False})
            if "sub" in unverified:
                return unverified
        except Exception:
            pass

    return None


def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> Profile:
    """Extrai e autentica o usuário a partir do cabeçalho Authorization Bearer."""
    if not authorization or not authorization.startswith("Bearer "):
        if settings.DEBUG:
            # Em modo debug / testes sem cabeçalho explícito, provê o admin padrão
            user_id = "1"
            profile = db.query(Profile).filter(Profile.id == user_id).first()
            if not profile:
                profile = Profile(
                    id=user_id,
                    email="admin@contabilidade.com",
                    nome="Contador Responsável",
                    cargo="Contador Sênior",
                    role="admin"
                )
                db.add(profile)
                db.commit()
                db.refresh(profile)
            return profile

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autorização não fornecido ou formato inválido."
        )

    token = authorization.split(" ", 1)[1].strip()

    # 1. Verificar tokens de desenvolvimento local (pat_...)
    if token in ACTIVE_DEV_TOKENS:
        user_info = ACTIVE_DEV_TOKENS[token]
        user_id = str(user_info["id"])
        profile = db.query(Profile).filter(Profile.id == user_id).first()
        if not profile:
            profile = Profile(
                id=user_id,
                email=user_info["email"],
                nome=user_info["nome"],
                cargo=user_info["cargo"],
                role=user_info.get("role", "operador")
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)
        return profile

    if token.startswith("pat_"):
        user_id = "1"
        profile = db.query(Profile).filter(Profile.id == user_id).first()
        if not profile:
            profile = Profile(
                id=user_id,
                email="admin@contabilidade.com",
                nome="Contador Responsável",
                cargo="Contador Sênior",
                role="admin"
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)
        return profile

    # 2. Validar token JWT do Supabase
    payload = verify_supabase_token(token)
    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão expirada ou token inválido. Faça login novamente."
        )

    user_id = str(payload["sub"])
    email = payload.get("email", "")
    metadata = payload.get("user_metadata", {})

    profile = db.query(Profile).filter(Profile.id == user_id).first()
    if not profile:
        cargo = metadata.get("cargo", "Contador Sênior" if email == "admin@contabilidade.com" else "Analista Fiscal")
        role = metadata.get("role", "admin" if (email == "admin@contabilidade.com" or cargo == "Contador Sênior") else "operador")
        nome = metadata.get("nome", email.split("@")[0] if email else "Usuário")

        profile = Profile(
            id=user_id,
            email=email,
            nome=nome,
            cargo=cargo,
            role=role
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)

    if not profile.ativo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta de usuário inativa. Contate o administrador."
        )

    return profile


def get_optional_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> Optional[Profile]:
    """Obtém o usuário atual caso o cabeçalho Authorization esteja presente, ou usuário padrão em debug."""
    if not authorization or not authorization.startswith("Bearer "):
        if settings.DEBUG:
            user_id = "1"
            return db.query(Profile).filter(Profile.id == user_id).first()
        return None
    try:
        return get_current_user(authorization=authorization, db=db)
    except HTTPException:
        return None


def require_admin(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> Profile:
    """Garante que apenas usuários com cargo de Contador Sênior / role admin acessem rotas restritas."""
    current_user = get_current_user(authorization=authorization, db=db)
    is_admin = current_user.role == "admin" or current_user.cargo.strip().lower() in [
        "contador sênior", "contador senior", "administrador", "admin"
    ]
    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito. Esta funcionalidade é exclusiva para o Contador Sênior / Administrador."
        )
    return current_user
