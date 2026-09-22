from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.api.persistence import commit_and_refresh, delete_and_commit, get_by_id_or_404
from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.perfil_regras import PerfilRegras
from app.models.regra_reclassificacao_cfop import ExcecaoReclassificacaoCfop, RegraReclassificacaoCfop
from app.schemas.regra_reclassificacao_cfop import (
    ExcecaoReclassificacaoCreate, ExcecaoReclassificacaoOut,
    RegraReclassificacaoCreate, RegraReclassificacaoOut, RegraReclassificacaoUpdate,
)

router = APIRouter(
    prefix="/regras-reclassificacao-cfop",
    tags=["Reclassificação de CFOP por Produto"],
    dependencies=[Depends(get_current_user)],
)


def _conflita(
    db: Session,
    perfil_id: int,
    ncm: str,
    origem_sufixo: Optional[str],
    termos: Optional[List[str]],
    ignorar_id: Optional[int] = None,
) -> bool:
    query = db.query(RegraReclassificacaoCfop).filter(
        RegraReclassificacaoCfop.perfil_regras_id == perfil_id,
        RegraReclassificacaoCfop.ncm == ncm,
        RegraReclassificacaoCfop.cfop_origem_sufixo == origem_sufixo,
    )
    if ignorar_id is not None:
        query = query.filter(RegraReclassificacaoCfop.id != ignorar_id)
    alvo = sorted(termos or [])
    return any(sorted(r.termos_inclusao or []) == alvo for r in query.all())


@router.post("", response_model=RegraReclassificacaoOut, status_code=status.HTTP_201_CREATED)
def criar_regra_reclassificacao(payload: RegraReclassificacaoCreate, db: Session = Depends(get_db)):
    perfil = db.query(PerfilRegras).filter(PerfilRegras.id == payload.perfil_regras_id).first()
    if not perfil:
        raise HTTPException(status_code=404, detail="Perfil de regras não encontrado.")

    if _conflita(
        db, payload.perfil_regras_id, payload.ncm, payload.cfop_origem_sufixo, payload.termos_inclusao
    ):
        raise HTTPException(
            status_code=409,
            detail=f"Já existe uma regra de reclassificação para o NCM '{payload.ncm}' com esses mesmos critérios.",
        )

    regra = RegraReclassificacaoCfop(
        perfil_regras_id=payload.perfil_regras_id,
        ncm=payload.ncm,
        cfop_origem_sufixo=payload.cfop_origem_sufixo,
        cfop_destino_sufixo=payload.cfop_destino_sufixo,
        termos_inclusao=payload.termos_inclusao or [],
        termos_exclusao=payload.termos_exclusao or [],
        descricao=payload.descricao,
    )
    db.add(regra)
    return commit_and_refresh(db, regra)


@router.get("", response_model=List[RegraReclassificacaoOut])
def listar_regras_reclassificacao(
    perfil_id: Optional[int] = None,
    ncm: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # Mesma razão de ``regras_reducao_produto``: as exceções entram na resposta.
    query = db.query(RegraReclassificacaoCfop).options(
        selectinload(RegraReclassificacaoCfop.excecoes)
    )
    if perfil_id:
        query = query.filter(RegraReclassificacaoCfop.perfil_regras_id == perfil_id)
    if ncm:
        query = query.filter(RegraReclassificacaoCfop.ncm == ncm.strip())
    return query.order_by(RegraReclassificacaoCfop.ncm).all()


@router.get("/{id}", response_model=RegraReclassificacaoOut)
def obter_regra_reclassificacao(id: int, db: Session = Depends(get_db)):
    return get_by_id_or_404(db, RegraReclassificacaoCfop, id, "Regra de reclassificação não encontrada.")


@router.put("/{id}", response_model=RegraReclassificacaoOut)
def atualizar_regra_reclassificacao(id: int, payload: RegraReclassificacaoUpdate, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraReclassificacaoCfop, id, "Regra de reclassificação não encontrada.")

    if payload.ncm is not None:
        regra.ncm = payload.ncm
    if "cfop_origem_sufixo" in payload.__fields_set__:
        regra.cfop_origem_sufixo = payload.cfop_origem_sufixo
    if payload.cfop_destino_sufixo is not None:
        regra.cfop_destino_sufixo = payload.cfop_destino_sufixo
    if payload.termos_inclusao is not None:
        regra.termos_inclusao = payload.termos_inclusao
    if payload.termos_exclusao is not None:
        regra.termos_exclusao = payload.termos_exclusao
    if "descricao" in payload.__fields_set__:
        regra.descricao = payload.descricao

    if _conflita(
        db, regra.perfil_regras_id, regra.ncm, regra.cfop_origem_sufixo, regra.termos_inclusao, ignorar_id=id
    ):
        raise HTTPException(
            status_code=409,
            detail=f"Já existe uma regra de reclassificação para o NCM '{regra.ncm}' com esses mesmos critérios.",
        )
    return commit_and_refresh(db, regra)


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
def deletar_regra_reclassificacao(id: int, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraReclassificacaoCfop, id, "Regra de reclassificação não encontrada.")
    delete_and_commit(db, regra)


@router.post("/{id}/excecoes", response_model=ExcecaoReclassificacaoOut,
             status_code=status.HTTP_201_CREATED)
def criar_excecao(id: int, payload: ExcecaoReclassificacaoCreate, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraReclassificacaoCfop, id, "Regra de reclassificação não encontrada.")
    excecao = ExcecaoReclassificacaoCfop(
        regra_reclassificacao_id=regra.id,
        descricao_exata=payload.descricao_exata,
        aplicar=payload.aplicar,
        observacao=payload.observacao,
    )
    db.add(excecao)
    return commit_and_refresh(
        db, excecao, conflict_detail="Já existe uma exceção com esta descrição nesta regra."
    )


@router.delete("/{id}/excecoes/{excecao_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_admin)])
def deletar_excecao(id: int, excecao_id: int, db: Session = Depends(get_db)):
    excecao = get_by_id_or_404(db, ExcecaoReclassificacaoCfop, excecao_id, "Exceção não encontrada.")
    if excecao.regra_reclassificacao_id != id:
        raise HTTPException(status_code=404, detail="Exceção não pertence a esta regra.")
    delete_and_commit(db, excecao)
