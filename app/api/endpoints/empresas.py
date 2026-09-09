from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.models.empresa import Empresa
from app.models.perfil_regras import PerfilRegras
from app.models.regra_aliquota_empresa import RegraAliquotaEmpresa
from app.schemas.empresa import EmpresaCreate, EmpresaUpdate, EmpresaOut
from app.schemas.regra_aliquota_empresa import TermoAcordoOut, TermoAcordoUpsert
from app.services.validation.sanity_checker import validate_cnpj_digits
from app.api.persistence import commit_and_refresh, delete_and_commit, get_by_id_or_404

router = APIRouter(
    prefix="/empresas",
    tags=["Empresas"],
    dependencies=[Depends(get_current_user)],
)

@router.post("", response_model=EmpresaOut, status_code=status.HTTP_201_CREATED)
def criar_empresa(payload: EmpresaCreate, db: Session = Depends(get_db)):
    if not validate_cnpj_digits(payload.cnpj):
        raise HTTPException(status_code=422, detail=f"CNPJ '{payload.cnpj}' é inválido pelos dígitos verificadores.")

    existente = db.query(Empresa).filter(Empresa.cnpj == payload.cnpj).first()
    if existente:
        raise HTTPException(status_code=400, detail=f"Já existe uma empresa cadastrada com o CNPJ '{payload.cnpj}'.")

    perfil = db.query(PerfilRegras).filter(PerfilRegras.id == payload.perfil_regras_id).first()
    if not perfil:
        raise HTTPException(status_code=404, detail=f"Perfil de regras com ID {payload.perfil_regras_id} não encontrado.")

    empresa = Empresa(
        razao_social=payload.razao_social,
        cnpj=payload.cnpj,
        inscricao_estadual=payload.inscricao_estadual,
        uf=payload.uf,
        perfil_regras_id=payload.perfil_regras_id,
        ativo=payload.ativo
    )
    db.add(empresa)
    return commit_and_refresh(db, empresa)

@router.get("", response_model=List[EmpresaOut])
def listar_empresas(
    uf: Optional[str] = None,
    perfil_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Empresa)
    if uf:
        query = query.filter(Empresa.uf == uf.strip().upper())
    if perfil_id:
        query = query.filter(Empresa.perfil_regras_id == perfil_id)
    return query.all()

@router.get("/{id}", response_model=EmpresaOut)
def obter_empresa(id: int, db: Session = Depends(get_db)):
    return get_by_id_or_404(db, Empresa, id, "Empresa não encontrada.")

@router.put("/{id}", response_model=EmpresaOut)
def atualizar_empresa(id: int, payload: EmpresaUpdate, db: Session = Depends(get_db)):
    empresa = get_by_id_or_404(db, Empresa, id, "Empresa não encontrada.")

    if payload.cnpj is not None:
        if not validate_cnpj_digits(payload.cnpj):
            raise HTTPException(status_code=422, detail=f"CNPJ '{payload.cnpj}' é inválido.")
        existente = db.query(Empresa).filter(Empresa.cnpj == payload.cnpj, Empresa.id != id).first()
        if existente:
            raise HTTPException(status_code=400, detail="Outra empresa já utiliza este CNPJ.")
        empresa.cnpj = payload.cnpj

    if payload.razao_social is not None:
        empresa.razao_social = payload.razao_social
    if "inscricao_estadual" in payload.__fields_set__:
        empresa.inscricao_estadual = payload.inscricao_estadual
    if payload.uf is not None:
        empresa.uf = payload.uf
    if payload.perfil_regras_id is not None:
        perfil = db.query(PerfilRegras).filter(PerfilRegras.id == payload.perfil_regras_id).first()
        if not perfil:
            raise HTTPException(status_code=404, detail="Perfil de regras não encontrado.")
        empresa.perfil_regras_id = payload.perfil_regras_id
    if payload.ativo is not None:
        empresa.ativo = payload.ativo

    return commit_and_refresh(db, empresa)

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
def deletar_empresa(id: int, db: Session = Depends(get_db)):
    empresa = get_by_id_or_404(db, Empresa, id, "Empresa não encontrada.")
    if empresa.solicitacoes:
        raise HTTPException(status_code=409, detail="A empresa possui solicitações e não pode ser excluída.")
    delete_and_commit(db, empresa)


@router.put("/{id}/termo-acordo", response_model=TermoAcordoOut)
def definir_termo_acordo(id: int, payload: TermoAcordoUpsert, db: Session = Depends(get_db)):
    """Cria ou substitui o termo de acordo da empresa.

    Upsert em vez de coleção porque a empresa tem no máximo um termo — o cliente
    não precisa rastrear um id separado.
    """
    empresa = get_by_id_or_404(db, Empresa, id, "Empresa não encontrada.")

    termo = (
        db.query(RegraAliquotaEmpresa)
        .filter(RegraAliquotaEmpresa.empresa_id == empresa.id)
        .first()
    )
    if termo is None:
        termo = RegraAliquotaEmpresa(empresa_id=empresa.id)
        db.add(termo)

    termo.aliquota = payload.aliquota
    termo.descricao = payload.descricao
    return commit_and_refresh(db, termo)


@router.delete("/{id}/termo-acordo", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[Depends(require_admin)])
def remover_termo_acordo(id: int, db: Session = Depends(get_db)):
    empresa = get_by_id_or_404(db, Empresa, id, "Empresa não encontrada.")
    termo = (
        db.query(RegraAliquotaEmpresa)
        .filter(RegraAliquotaEmpresa.empresa_id == empresa.id)
        .first()
    )
    if termo is None:
        raise HTTPException(status_code=404, detail="Esta empresa não possui termo de acordo.")
    delete_and_commit(db, termo)
