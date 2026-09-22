from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.api.persistence import commit_and_refresh, delete_and_commit, get_by_id_or_404
from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.perfil_regras import PerfilRegras
from app.models.regra_reducao_produto import ExcecaoReducaoProduto, RegraReducaoProduto
from app.schemas.regra_reducao_produto import (
    ExcecaoReducaoCreate, ExcecaoReducaoOut, RegraReducaoCreate,
    RegraReducaoOut, RegraReducaoUpdate,
)

router = APIRouter(
    prefix="/regras-reducao-produto",
    tags=["Reduções por Produto (NCM + Descrição)"],
    dependencies=[Depends(get_current_user)],
)


def _conflita(db: Session, perfil_id: int, ncm: str, termos: List[str], ignorar_id: Optional[int] = None) -> bool:
    """Duplicata literal: mesmo perfil, mesmo NCM e mesmo conjunto de termos.

    Duas regras para o mesmo NCM são legítimas (vergalhão e barra chata); o que
    não pode é a mesma regra duas vezes.
    """
    query = db.query(RegraReducaoProduto).filter(
        RegraReducaoProduto.perfil_regras_id == perfil_id,
        RegraReducaoProduto.ncm == ncm,
    )
    if ignorar_id is not None:
        query = query.filter(RegraReducaoProduto.id != ignorar_id)
    alvo = sorted(termos)
    return any(sorted(r.termos_inclusao or []) == alvo for r in query.all())


@router.post("", response_model=RegraReducaoOut, status_code=status.HTTP_201_CREATED)
def criar_regra_reducao(payload: RegraReducaoCreate, db: Session = Depends(get_db)):
    perfil = db.query(PerfilRegras).filter(PerfilRegras.id == payload.perfil_regras_id).first()
    if not perfil:
        raise HTTPException(status_code=404, detail="Perfil de regras não encontrado.")

    if _conflita(db, payload.perfil_regras_id, payload.ncm, payload.termos_inclusao):
        raise HTTPException(
            status_code=409,
            detail=f"Já existe uma regra para o NCM '{payload.ncm}' com estes mesmos termos de inclusão.",
        )

    regra = RegraReducaoProduto(
        perfil_regras_id=payload.perfil_regras_id,
        ncm=payload.ncm,
        termos_inclusao=payload.termos_inclusao,
        termos_exclusao=payload.termos_exclusao,
        aliquota=payload.aliquota,
        descricao=payload.descricao,
    )
    db.add(regra)
    return commit_and_refresh(db, regra)


@router.get("", response_model=List[RegraReducaoOut])
def listar_regras_reducao(
    perfil_id: Optional[int] = None,
    ncm: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # ``RegraReducaoOut`` serializa as exceções de cada regra: sem carregá-las
    # junto, a listagem dispara uma consulta extra por regra retornada.
    query = db.query(RegraReducaoProduto).options(
        selectinload(RegraReducaoProduto.excecoes)
    )
    if perfil_id:
        query = query.filter(RegraReducaoProduto.perfil_regras_id == perfil_id)
    if ncm:
        query = query.filter(RegraReducaoProduto.ncm == ncm.strip())
    return query.all()


@router.get("/{id}", response_model=RegraReducaoOut)
def obter_regra_reducao(id: int, db: Session = Depends(get_db)):
    return get_by_id_or_404(db, RegraReducaoProduto, id, "Regra de redução não encontrada.")


@router.put("/{id}", response_model=RegraReducaoOut)
def atualizar_regra_reducao(id: int, payload: RegraReducaoUpdate, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraReducaoProduto, id, "Regra de redução não encontrada.")

    if payload.ncm is not None:
        regra.ncm = payload.ncm
    if payload.termos_inclusao is not None:
        regra.termos_inclusao = payload.termos_inclusao
    if payload.termos_exclusao is not None:
        regra.termos_exclusao = payload.termos_exclusao
    if payload.aliquota is not None:
        regra.aliquota = payload.aliquota
    if "descricao" in payload.__fields_set__:
        regra.descricao = payload.descricao

    if _conflita(db, regra.perfil_regras_id, regra.ncm, regra.termos_inclusao, ignorar_id=id):
        raise HTTPException(
            status_code=409,
            detail=f"Já existe uma regra para o NCM '{regra.ncm}' com estes mesmos termos de inclusão.",
        )
    return commit_and_refresh(db, regra)


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
def deletar_regra_reducao(id: int, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraReducaoProduto, id, "Regra de redução não encontrada.")
    delete_and_commit(db, regra)


@router.post("/{id}/excecoes", response_model=ExcecaoReducaoOut,
             status_code=status.HTTP_201_CREATED)
def criar_excecao(id: int, payload: ExcecaoReducaoCreate, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraReducaoProduto, id, "Regra de redução não encontrada.")
    excecao = ExcecaoReducaoProduto(
        regra_reducao_id=regra.id,
        descricao_exata=payload.descricao_exata,
        enquadrado=payload.enquadrado,
        observacao=payload.observacao,
    )
    db.add(excecao)
    return commit_and_refresh(
        db, excecao, conflict_detail="Já existe uma exceção com esta descrição nesta regra."
    )


@router.delete("/{id}/excecoes/{excecao_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_admin)])
def deletar_excecao(id: int, excecao_id: int, db: Session = Depends(get_db)):
    excecao = get_by_id_or_404(db, ExcecaoReducaoProduto, excecao_id, "Exceção não encontrada.")
    if excecao.regra_reducao_id != id:
        raise HTTPException(status_code=404, detail="Exceção não pertence a esta regra.")
    delete_and_commit(db, excecao)
