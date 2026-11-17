from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.regra_aliquota import RegraAliquotaDestino
from app.models.perfil_regras import PerfilRegras
from app.schemas.regra_aliquota import RegraAliquotaCreate, RegraAliquotaUpdate, RegraAliquotaOut
from app.api.persistence import commit_and_refresh, delete_and_commit, get_by_id_or_404

router = APIRouter(
    prefix="/regras-aliquotas",
    tags=["Regras de Alíquotas (A.DST)"],
    dependencies=[Depends(get_current_user)],
)

def _conflita(
    db: Session,
    perfil_id: int,
    uf: str,
    ncm: Optional[str],
    ignorar_id: Optional[int] = None,
) -> bool:
    query = db.query(RegraAliquotaDestino).filter(
        RegraAliquotaDestino.perfil_regras_id == perfil_id,
        RegraAliquotaDestino.uf == uf,
    )
    if ignorar_id is not None:
        query = query.filter(RegraAliquotaDestino.id != ignorar_id)
    if ncm:
        query = query.filter(RegraAliquotaDestino.ncm == ncm)
    else:
        query = query.filter(or_(RegraAliquotaDestino.ncm.is_(None), RegraAliquotaDestino.ncm == ""))
    return query.first() is not None


@router.post("", response_model=RegraAliquotaOut, status_code=status.HTTP_201_CREATED)
def criar_regra_aliquota(payload: RegraAliquotaCreate, db: Session = Depends(get_db)):
    get_by_id_or_404(db, PerfilRegras, payload.perfil_regras_id, "Perfil de regras não encontrado.")

    if _conflita(db, payload.perfil_regras_id, payload.uf, payload.ncm):
        ncm_txt = f" e NCM '{payload.ncm}'" if payload.ncm else " padrão"
        raise HTTPException(
            status_code=400,
            detail=f"Já existe uma regra de alíquota para UF '{payload.uf}'{ncm_txt} neste perfil."
        )

    regra = RegraAliquotaDestino(
        perfil_regras_id=payload.perfil_regras_id,
        uf=payload.uf,
        ncm=payload.ncm,
        aliquota=payload.aliquota,
        descricao=payload.descricao,
        parametros_extras=payload.parametros_extras or {}
    )
    db.add(regra)
    return commit_and_refresh(db, regra)

@router.get("", response_model=List[RegraAliquotaOut])
def listar_regras_aliquotas(
    perfil_id: Optional[int] = None,
    uf: Optional[str] = None,
    ncm: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(RegraAliquotaDestino)
    if perfil_id:
        query = query.filter(RegraAliquotaDestino.perfil_regras_id == perfil_id)
    if uf:
        query = query.filter(RegraAliquotaDestino.uf == uf.strip().upper())
    if ncm:
        query = query.filter(RegraAliquotaDestino.ncm == ncm.strip())
    return query.all()

@router.get("/{id}", response_model=RegraAliquotaOut)
def obter_regra_aliquota(id: int, db: Session = Depends(get_db)):
    return get_by_id_or_404(
        db, RegraAliquotaDestino, id, "Regra de alíquota não encontrada."
    )

@router.put("/{id}", response_model=RegraAliquotaOut)
def atualizar_regra_aliquota(id: int, payload: RegraAliquotaUpdate, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(
        db, RegraAliquotaDestino, id, "Regra de alíquota não encontrada."
    )

    if payload.uf is not None:
        regra.uf = payload.uf
    if "ncm" in payload.__fields_set__:
        regra.ncm = payload.ncm
    if payload.aliquota is not None:
        regra.aliquota = payload.aliquota
    if "descricao" in payload.__fields_set__:
        regra.descricao = payload.descricao
    if payload.parametros_extras is not None:
        regra.parametros_extras = payload.parametros_extras

    if _conflita(db, regra.perfil_regras_id, regra.uf, regra.ncm, ignorar_id=id):
        raise HTTPException(status_code=409, detail="Já existe uma regra para este perfil, UF e NCM.")
    return commit_and_refresh(db, regra)

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_regra_aliquota(id: int, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(
        db, RegraAliquotaDestino, id, "Regra de alíquota não encontrada."
    )
    delete_and_commit(db, regra)
