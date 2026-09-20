from copy import deepcopy
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.perfil_regras import PerfilRegras
from app.schemas.perfil_regras import PerfilRegrasCreate, PerfilRegrasUpdate, PerfilRegrasOut, PerfilRegrasDuplicar
from app.api.persistence import commit_and_refresh, delete_and_commit, get_by_id_or_404

router = APIRouter(
    prefix="/perfis-regras",
    tags=["Perfis de Regras"],
    dependencies=[Depends(get_current_user)],
)

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
        existente = db.query(PerfilRegras).filter(PerfilRegras.nome == payload.nome, PerfilRegras.id != id).first()
        if existente:
            raise HTTPException(status_code=409, detail="Outro perfil já utiliza este nome.")
        perfil.nome = payload.nome
    if "descricao" in payload.__fields_set__:
        perfil.descricao = payload.descricao
    if payload.configuracoes_extras is not None:
        perfil.configuracoes_extras = payload.configuracoes_extras

    return commit_and_refresh(db, perfil)

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
def deletar_perfil(id: int, db: Session = Depends(get_db)):
    perfil = get_by_id_or_404(db, PerfilRegras, id, "Perfil de regras não encontrado.")
    if perfil.empresas:
        raise HTTPException(status_code=409, detail="O perfil está vinculado a empresas e não pode ser excluído.")
    delete_and_commit(db, perfil)


@router.post("/{id}/duplicar", response_model=PerfilRegrasOut, status_code=status.HTTP_201_CREATED)
def duplicar_perfil(id: int, payload: PerfilRegrasDuplicar, db: Session = Depends(get_db)):
    origem = get_by_id_or_404(db, PerfilRegras, id, "Perfil de regras não encontrado.")
    if db.query(PerfilRegras).filter(PerfilRegras.nome == payload.nome).first():
        raise HTTPException(status_code=409, detail="Outro perfil já utiliza este nome.")

    copia = PerfilRegras(
        nome=payload.nome,
        descricao=origem.descricao,
        configuracoes_extras=deepcopy(origem.configuracoes_extras),
    )
    # Copiar apenas dados das regras: identidades, vínculos e datas são novos.
    def copiar_registro(registro):
        return type(registro)(**{
            coluna.key: deepcopy(getattr(registro, coluna.key))
            for coluna in registro.__table__.columns
            if not coluna.primary_key and not coluna.foreign_keys
            and coluna.key not in {"criado_em", "atualizado_em"}
        })

    for relacao in (
        "regras_aliquotas", "regras_cfop", "regras_reducao_produto",
        "regras_reclassificacao_cfop", "regras_exclusao_parcial",
    ):
        for regra in getattr(origem, relacao):
            nova_regra = copiar_registro(regra)
            if relacao in {"regras_reducao_produto", "regras_reclassificacao_cfop"}:
                nova_regra.excecoes = [copiar_registro(excecao) for excecao in regra.excecoes]
            getattr(copia, relacao).append(nova_regra)

    # Uma única transação evita deixar um perfil parcialmente duplicado.
    db.add(copia)
    return commit_and_refresh(db, copia, "Outro perfil já utiliza este nome.")
