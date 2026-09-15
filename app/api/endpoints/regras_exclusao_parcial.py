from typing import List, Optional
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.persistence import commit_and_refresh, delete_and_commit, get_by_id_or_404
from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.perfil_regras import PerfilRegras
from app.models.regra_exclusao_parcial import RegraExclusaoParcial
from app.schemas.regra_exclusao_parcial import (
    CargaPadraoBAResponse,
    RegraExclusaoParcialCreate,
    RegraExclusaoParcialOut,
    RegraExclusaoParcialUpdate,
    normalizar_termos_exclusao,
)

router = APIRouter(
    prefix="/regras-exclusao-parcial",
    tags=["Exclusões da Parcial (NCM + Descrição)"],
    dependencies=[Depends(get_current_user)],
)

REGRAS_PADRAO_BAHIA = [
    {
        "chave_origem": "padrao_ba_charque",
        "mercadoria": "Charque",
        "ncm": "02102000",
        "termos": ["CHARQUE"],
        "motivo": "imposto_pago_entrada",
    },
    {
        "chave_origem": "padrao_ba_mistura_bolo",
        "mercadoria": "Mistura para bolo",
        "ncm": "19012090",
        "termos": ["MISTURA", "BOLO"],
        "motivo": "imposto_pago_entrada",
    },
    {
        "chave_origem": "padrao_ba_flocao_milho",
        "mercadoria": "Flocão de milho",
        "ncm": "11041900",
        "termos": ["FLOCAO", "MILHO"],
        "motivo": "isencao",
    },
    {
        "chave_origem": "padrao_ba_farinha_milho",
        "mercadoria": "Farinha de milho",
        "ncm": "11022000",
        "termos": ["FARINHA", "MILHO"],
        "motivo": "isencao",
    },
    {
        "chave_origem": "padrao_ba_feijao",
        "mercadoria": "Feijão",
        "ncm": "07133399",
        "termos": ["FEIJAO"],
        "motivo": "isencao",
    },
    {
        "chave_origem": "padrao_ba_sal",
        "mercadoria": "Sal",
        "ncm": "25010020",
        "termos": ["SAL"],
        "motivo": "isencao",
    },
    {
        "chave_origem": "padrao_ba_acucar",
        "mercadoria": "Açúcar",
        "ncm": "17019900",
        "termos": ["ACUCAR"],
        "motivo": "imposto_pago_entrada",
    },
]


class CargaPadraoBAPayload(BaseModel):
    perfil_regras_id: int = Field(..., example=1)


def _conflita(
    db: Session,
    perfil_id: int,
    uf: str,
    ncm: str,
    termos: List[str],
    ignorar_id: Optional[int] = None,
) -> bool:
    """Duplicata literal: mesmo perfil, mesma UF, mesmo NCM e mesma combinação de termos."""
    query = db.query(RegraExclusaoParcial).filter(
        RegraExclusaoParcial.perfil_regras_id == perfil_id,
        RegraExclusaoParcial.uf == uf.upper(),
        RegraExclusaoParcial.ncm == ncm,
    )
    if ignorar_id is not None:
        query = query.filter(RegraExclusaoParcial.id != ignorar_id)
    alvo = sorted(termos)
    return any(
        sorted(r.termos_obrigatorios or []) == alvo
        for r in query.all()
    )


@router.post("", response_model=RegraExclusaoParcialOut, status_code=status.HTTP_201_CREATED)
def criar_regra_exclusao(
    payload: RegraExclusaoParcialCreate,
    db: Session = Depends(get_db),
):
    perfil = db.query(PerfilRegras).filter(PerfilRegras.id == payload.perfil_regras_id).first()
    if not perfil:
        raise HTTPException(status_code=404, detail="Perfil de regras não encontrado.")

    if _conflita(db, payload.perfil_regras_id, payload.uf, payload.ncm, payload.termos_obrigatorios):
        raise HTTPException(
            status_code=409,
            detail=f"Já existe uma regra de exclusão para o NCM '{payload.ncm}' na UF '{payload.uf}' com estes mesmos termos obrigatórios.",
        )

    regra = RegraExclusaoParcial(
        perfil_regras_id=payload.perfil_regras_id,
        uf=payload.uf.upper(),
        ncm=payload.ncm,
        descricao=payload.descricao,
        termos_obrigatorios=payload.termos_obrigatorios,
        motivo=payload.motivo,
        ativo=payload.ativo,
        chave_origem=payload.chave_origem,
    )
    db.add(regra)
    return commit_and_refresh(db, regra)


@router.get("", response_model=List[RegraExclusaoParcialOut])
def listar_regras_exclusao(
    perfil_id: Optional[int] = None,
    uf: Optional[str] = None,
    ncm: Optional[str] = None,
    ativo: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    query = db.query(RegraExclusaoParcial)
    if perfil_id is not None:
        query = query.filter(RegraExclusaoParcial.perfil_regras_id == perfil_id)
    if uf is not None:
        query = query.filter(RegraExclusaoParcial.uf == uf.strip().upper())
    if ncm is not None:
        query = query.filter(RegraExclusaoParcial.ncm == ncm.strip())
    if ativo is not None:
        query = query.filter(RegraExclusaoParcial.ativo.is_(ativo))
    return query.order_by(RegraExclusaoParcial.uf, RegraExclusaoParcial.ncm).all()


@router.get("/{id}", response_model=RegraExclusaoParcialOut)
def obter_regra_exclusao(id: int, db: Session = Depends(get_db)):
    return get_by_id_or_404(db, RegraExclusaoParcial, id, "Regra de exclusão não encontrada.")


@router.put("/{id}", response_model=RegraExclusaoParcialOut)
def atualizar_regra_exclusao(
    id: int,
    payload: RegraExclusaoParcialUpdate,
    db: Session = Depends(get_db),
):
    regra = get_by_id_or_404(db, RegraExclusaoParcial, id, "Regra de exclusão não encontrada.")

    uf_efetiva = payload.uf.upper() if payload.uf is not None else regra.uf
    ncm_efetivo = payload.ncm if payload.ncm is not None else regra.ncm
    termos_efetivos = payload.termos_obrigatorios if payload.termos_obrigatorios is not None else regra.termos_obrigatorios

    if _conflita(db, regra.perfil_regras_id, uf_efetiva, ncm_efetivo, termos_efetivos, ignorar_id=id):
        raise HTTPException(
            status_code=409,
            detail=f"Já existe uma regra de exclusão para o NCM '{ncm_efetivo}' na UF '{uf_efetiva}' com estes mesmos termos obrigatórios.",
        )

    if payload.uf is not None:
        regra.uf = payload.uf.upper()
    if payload.ncm is not None:
        regra.ncm = payload.ncm
    if "descricao" in payload.__fields_set__:
        regra.descricao = payload.descricao
    if payload.termos_obrigatorios is not None:
        regra.termos_obrigatorios = payload.termos_obrigatorios
    if payload.motivo is not None:
        regra.motivo = payload.motivo
    if payload.ativo is not None:
        regra.ativo = payload.ativo
    if "chave_origem" in payload.__fields_set__:
        regra.chave_origem = payload.chave_origem

    return commit_and_refresh(db, regra)


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
def deletar_regra_exclusao(id: int, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraExclusaoParcial, id, "Regra de exclusão não encontrada.")
    delete_and_commit(db, regra)


@router.post("/carregar-padrao-ba", response_model=CargaPadraoBAResponse)
def carregar_padrao_bahia(
    payload: CargaPadraoBAPayload,
    db: Session = Depends(get_db),
):
    perfil = db.query(PerfilRegras).filter(PerfilRegras.id == payload.perfil_regras_id).first()
    if not perfil:
        raise HTTPException(status_code=404, detail="Perfil de regras não encontrado.")

    existentes_count = 0
    inseridas_count = 0

    regras_atuais = (
        db.query(RegraExclusaoParcial)
        .filter(
            RegraExclusaoParcial.perfil_regras_id == payload.perfil_regras_id,
            RegraExclusaoParcial.uf == "BA",
        )
        .all()
    )

    regras_por_chave = {r.chave_origem: r for r in regras_atuais if r.chave_origem}
    regras_por_ncm = {r.ncm: r for r in regras_atuais}

    for item in REGRAS_PADRAO_BAHIA:
        chave = item["chave_origem"]
        if chave in regras_por_chave:
            existentes_count += 1
        elif item["ncm"] in regras_por_ncm:
            regra_legada = regras_por_ncm[item["ncm"]]
            if not regra_legada.chave_origem:
                regra_legada.chave_origem = chave
            existentes_count += 1
        else:
            termos_norm = normalizar_termos_exclusao(item["termos"])
            nova = RegraExclusaoParcial(
                perfil_regras_id=payload.perfil_regras_id,
                uf="BA",
                ncm=item["ncm"],
                descricao=item["mercadoria"],
                termos_obrigatorios=termos_norm,
                motivo=item["motivo"],
                ativo=True,
                chave_origem=chave,
            )
            db.add(nova)
            inseridas_count += 1

    if inseridas_count > 0 or any(r.chave_origem for r in regras_atuais):
        db.commit()

    todas_regras_ba = (
        db.query(RegraExclusaoParcial)
        .filter(
            RegraExclusaoParcial.perfil_regras_id == payload.perfil_regras_id,
            RegraExclusaoParcial.uf == "BA",
        )
        .order_by(RegraExclusaoParcial.ncm)
        .all()
    )

    return CargaPadraoBAResponse(
        inseridas=inseridas_count,
        existentes=existentes_count,
        total=len(todas_regras_ba),
        regras=todas_regras_ba,
    )
