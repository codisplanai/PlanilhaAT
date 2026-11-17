from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.regra_cfop import RegraCfopDestino
from app.models.perfil_regras import PerfilRegras
from app.schemas.regra_cfop import RegraCfopCreate, RegraCfopUpdate, RegraCfopOut, RegraCfopEfetivaOut
from app.services.rules_engine.cfop_resolver import CfopResolver
from app.api.persistence import commit_and_refresh, delete_and_commit, get_by_id_or_404

router = APIRouter(
    prefix="/regras-cfop",
    tags=["Regras de Roteamento CFOP -> Planilha"],
    dependencies=[Depends(get_current_user)],
)

@router.post("", response_model=RegraCfopOut, status_code=status.HTTP_201_CREATED)
def criar_regra_cfop(payload: RegraCfopCreate, db: Session = Depends(get_db)):
    if payload.perfil_regras_id is not None:
        get_by_id_or_404(db, PerfilRegras, payload.perfil_regras_id, "Perfil de regras não encontrado.")

    existente = (
        db.query(RegraCfopDestino)
        .filter(
            RegraCfopDestino.perfil_regras_id == payload.perfil_regras_id,
            RegraCfopDestino.cfop_sufixo == payload.cfop_sufixo
        )
        .first()
    )
    if existente:
        escopo = f"do perfil ID {payload.perfil_regras_id}" if payload.perfil_regras_id else "padrão global"
        raise HTTPException(
            status_code=400,
            detail=f"Já existe uma regra {escopo} para o CFOP sufixo '{payload.cfop_sufixo}'."
        )

    regra = RegraCfopDestino(
        perfil_regras_id=payload.perfil_regras_id,
        cfop_sufixo=payload.cfop_sufixo,
        destino=payload.destino,
        descricao=payload.descricao
    )
    db.add(regra)
    return commit_and_refresh(db, regra)

@router.get("", response_model=List[RegraCfopOut])
def listar_regras_cfop(
    perfil_id: Optional[int] = None,
    apenas_globais: bool = False,
    db: Session = Depends(get_db)
):
    query = db.query(RegraCfopDestino)
    if apenas_globais:
        query = query.filter(RegraCfopDestino.perfil_regras_id == None)
    elif perfil_id is not None:
        query = query.filter(RegraCfopDestino.perfil_regras_id == perfil_id)
    return query.order_by(RegraCfopDestino.cfop_sufixo).all()

@router.get("/efetivas", response_model=List[RegraCfopEfetivaOut])
def listar_regras_cfop_efetivas(perfil_id: int, db: Session = Depends(get_db)):
    """
    Visão efetiva de roteamento: padrões globais sobrepostos pelas exceções cadastradas
    no perfil informado. Mostra a origem ('global' ou 'perfil') de cada regra vigente.
    """
    return CfopResolver.listar_regras_efetivas(db, perfil_id)

@router.get("/{id}", response_model=RegraCfopOut)
def obter_regra_cfop(id: int, db: Session = Depends(get_db)):
    return get_by_id_or_404(db, RegraCfopDestino, id, "Regra de CFOP não encontrada.")

@router.put("/{id}", response_model=RegraCfopOut)
def atualizar_regra_cfop(id: int, payload: RegraCfopUpdate, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraCfopDestino, id, "Regra de CFOP não encontrada.")

    if payload.cfop_sufixo is not None:
        regra.cfop_sufixo = payload.cfop_sufixo
    if payload.destino is not None:
        regra.destino = payload.destino
    if "descricao" in payload.__fields_set__:
        regra.descricao = payload.descricao

    duplicate = db.query(RegraCfopDestino).filter(
        RegraCfopDestino.id != id,
        RegraCfopDestino.perfil_regras_id == regra.perfil_regras_id,
        RegraCfopDestino.cfop_sufixo == regra.cfop_sufixo,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Já existe uma regra neste escopo para o CFOP informado.")

    return commit_and_refresh(db, regra)

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_regra_cfop(id: int, db: Session = Depends(get_db)):
    regra = get_by_id_or_404(db, RegraCfopDestino, id, "Regra de CFOP não encontrada.")
    delete_and_commit(db, regra)
