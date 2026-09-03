from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, validator

from app.schemas.validators import (
    clean_cfop_sufixo,
    clean_cfop_sufixo_obrigatorio,
    clean_ncm_obrigatorio,
    normalizar_termos,
)
from app.services.rules_engine.descricao_matcher import normalizar


class ExcecaoReclassificacaoBase(BaseModel):
    descricao_exata: str = Field(..., min_length=1, max_length=255)
    aplicar: bool = False
    observacao: Optional[str] = Field(None, max_length=255)

    @validator("descricao_exata")
    def _normalizar_desc(cls, v: str) -> str:
        limpo = normalizar(v)
        if not limpo:
            raise ValueError("Descrição exata não pode ser vazia")
        return limpo


class ExcecaoReclassificacaoCreate(ExcecaoReclassificacaoBase):
    pass


class ExcecaoReclassificacaoOut(ExcecaoReclassificacaoBase):
    id: int
    regra_reclassificacao_id: int
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True


class RegraReclassificacaoBase(BaseModel):
    ncm: str = Field(..., example="73269090")
    cfop_origem_sufixo: Optional[str] = Field(
        None, example="102", description="CFOP de origem na nota (opcional, 3 ou 4 dígitos)"
    )
    cfop_destino_sufixo: str = Field(
        ..., example="405", description="Novo CFOP que o item deve assumir (3 ou 4 dígitos)"
    )
    termos_inclusao: Optional[List[str]] = Field(
        default_factory=list, example=["GRAMPO*"]
    )
    termos_exclusao: Optional[List[str]] = Field(
        default_factory=list, example=["PLASTICO"]
    )
    descricao: Optional[str] = Field(None, max_length=255, example="Grampos sujeitos a ST")

    @validator("ncm")
    def _ncm(cls, v: str) -> str:
        return clean_ncm_obrigatorio(v)

    @validator("cfop_origem_sufixo")
    def _cfop_origem(cls, v: Optional[str]) -> Optional[str]:
        return clean_cfop_sufixo(v)

    @validator("cfop_destino_sufixo")
    def _cfop_destino(cls, v: str) -> str:
        return clean_cfop_sufixo_obrigatorio(v)

    @validator("termos_inclusao", "termos_exclusao")
    def _termos(cls, v: Optional[List[str]]) -> List[str]:
        return normalizar_termos(v)


class RegraReclassificacaoCreate(RegraReclassificacaoBase):
    perfil_regras_id: int = Field(..., example=1)


class RegraReclassificacaoUpdate(BaseModel):
    ncm: Optional[str] = None
    cfop_origem_sufixo: Optional[str] = None
    cfop_destino_sufixo: Optional[str] = None
    termos_inclusao: Optional[List[str]] = None
    termos_exclusao: Optional[List[str]] = None
    descricao: Optional[str] = None

    @validator("ncm")
    def _ncm(cls, v: Optional[str]) -> Optional[str]:
        return clean_ncm_obrigatorio(v) if v is not None else None

    @validator("cfop_origem_sufixo")
    def _cfop_origem(cls, v: Optional[str]) -> Optional[str]:
        return clean_cfop_sufixo(v) if v is not None else None

    @validator("cfop_destino_sufixo")
    def _cfop_destino(cls, v: Optional[str]) -> Optional[str]:
        return clean_cfop_sufixo_obrigatorio(v) if v is not None else None

    @validator("termos_inclusao", "termos_exclusao")
    def _termos(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        return normalizar_termos(v) if v is not None else None


class RegraReclassificacaoOut(RegraReclassificacaoBase):
    id: int
    perfil_regras_id: int
    excecoes: List[ExcecaoReclassificacaoOut] = []
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
