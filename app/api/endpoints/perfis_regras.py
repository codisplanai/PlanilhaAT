from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.perfil_regras import PerfilRegras
from app.schemas.perfil_regras import PerfilRegrasCreate, PerfilRegrasUpdate, PerfilRegrasOut
from app.api.persistence import commit_and_refresh, delete_and_commit, get_by_id_or_404

router = APIRouter(prefix="/perfis-regras", tags=["Perfis de Regras"])

@router.post("", response_model=PerfilRegrasOut, status_code=status.HTTP_201_CREATED)
def criar_perfil(payload: PerfilRegrasCreate, db: Session = Depends(get_db)):
    existente = db.query(PerfilRegras).filter(PerfilRegras.nome == payload.nome).first()
    if existente:
        raise HTTPException(status_code=400, detail=f"Já existe um perfil com o nome '{payload.nome}'.")

    perfil = PerfilRegras(
        nome=payload.nome,
        descricao=payload.descricao,
        configuracoes_extras=payload.configuracoes_extras or {}
    )
    db.add(perfil)
    return commit_and_refresh(db, perfil)

@router.get("", response_model=List[PerfilRegrasOut])
def listar_perfis(db: Session = Depends(get_db)):
    return db.query(PerfilRegras).all()

@router.get("/{id}", response_model=PerfilRegrasOut)
def obter_perfil(id: int, db: Session = Depends(get_db)):
    return get_by_id_or_404(db, PerfilRegras, id, "Perfil de regras não encontrado.")

@router.put("/{id}", response_model=PerfilRegrasOut)
def atualizar_perfil(id: int, payload: PerfilRegrasUpdate, db: Session = Depends(get_db)):
    perfil = get_by_id_or_404(db, PerfilRegras, id, "Perfil de regras não encontrado.")

    if payload.nome is not None:
        perfil.nome = payload.nome
    if payload.descricao is not None:
        perfil.descricao = payload.descricao
    if payload.configuracoes_extras is not None:
        perfil.configuracoes_extras = payload.configuracoes_extras

    return commit_and_refresh(db, perfil)

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_perfil(id: int, db: Session = Depends(get_db)):
    perfil = get_by_id_or_404(db, PerfilRegras, id, "Perfil de regras não encontrado.")
    delete_and_commit(db, perfil)
