import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import LOCAL_USERS_FALLBACK, require_admin
from app.models.profile import Profile
from app.schemas.usuario import UsuarioCreate, UsuarioOut
from app.services.supabase_admin import (
    SupabaseAdminNaoConfigurado,
    SupabaseAdminService,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/usuarios", tags=["Usuários"])


def _gravar_perfil(db: Session, user_id: str, payload: UsuarioCreate) -> Profile:
    """Upsert do perfil: o trigger on_auth_user_created pode já ter criado a linha."""
    profile = db.query(Profile).filter(Profile.id == user_id).first()
    if profile is None:
        profile = Profile(id=user_id, email=payload.email)
        db.add(profile)
    profile.email = payload.email
    profile.nome = payload.nome
    profile.cargo = payload.cargo
    profile.role = payload.role
    profile.ativo = True
    db.commit()
    db.refresh(profile)
    return profile


def _desfazer_criacao(db: Session, user_id: str) -> None:
    """Remove a conta e o perfil sem depender de ON DELETE CASCADE.

    A FK com cascade existe em docs/supabase_schema.sql mas não em bancos
    criados pela migration 008, onde um perfil órfão bloquearia para sempre a
    recriação daquele e-mail (profiles.email é UNIQUE).
    """
    SupabaseAdminService.delete_user(user_id)
    try:
        orfao = db.query(Profile).filter(Profile.id == user_id).first()
        if orfao is not None:
            db.delete(orfao)
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("Perfil órfão %s não pôde ser removido", user_id)


@router.post(
    "",
    response_model=UsuarioOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def criar_usuario(payload: UsuarioCreate, db: Session = Depends(get_db)):
    if payload.email in LOCAL_USERS_FALLBACK:
        raise HTTPException(
            status_code=400,
            detail=(
                "Este e-mail pertence a uma conta institucional fixa e não pode "
                "ser criado por aqui."
            ),
        )

    if db.query(Profile).filter(Profile.email == payload.email).first():
        raise HTTPException(
            status_code=400,
            detail=f"Já existe um usuário com o e-mail '{payload.email}'.",
        )

    try:
        user_id = SupabaseAdminService.create_user(
            email=payload.email, password=payload.password, nome=payload.nome
        )
    except SupabaseAdminNaoConfigurado:
        logger.error("SUPABASE_SERVICE_ROLE_KEY ausente; criação de usuários indisponível")
        raise HTTPException(
            status_code=500,
            detail=(
                "Criação de usuários indisponível: SUPABASE_SERVICE_ROLE_KEY "
                "não está configurada no servidor."
            ),
        )

    try:
        return _gravar_perfil(db, user_id, payload)
    except Exception:
        db.rollback()
        _desfazer_criacao(db, user_id)
        logger.exception("Falha ao gravar perfil; criação revertida")
        raise HTTPException(
            status_code=500,
            detail="Não foi possível concluir a criação do usuário.",
        )
