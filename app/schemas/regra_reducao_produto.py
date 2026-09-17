from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, validator

from app.schemas.validators import clean_ncm_obrigatorio, normalizar_aliquota, normalizar_termos
from app.services.rules_engine.descricao_matcher import normalizar


class ExcecaoReducaoCreate(BaseModel):
    descricao_exata: str = Field(..., max_length=255, example="Vergalhão de Cobre")
    enquadrado: bool = Field(..., example=False)
    observacao: Optional[str] = Field(None, max_length=255)

    @validator("descricao_exata")
    def validate_descricao(cls, v):
        limpa = normalizar(v)
        if not limpa:
            raise ValueError("Descrição da exceção não pode ser vazia")
        return limpa

    class Config:
        extra = "forbid"


class ExcecaoReducaoOut(BaseModel):
    id: int
    regra_reducao_id: int
    descricao_exata: str
    enquadrado: bool
    observacao: Optional[str]
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True


class RegraReducaoBase(BaseModel):
    perfil_regras_id: int = Field(..., example=1)
    ncm: str = Field(..., example="72142000")
    termos_inclusao: List[str] = Field(..., example=["vergalh*"])
    termos_exclusao: List[str] = Field(default_factory=list, example=["cobre"])
    aliquota: Decimal = Field(..., example=0.1200)
    descricao: Optional[str] = Field(None, max_length=255, example="Vergalhões — Decreto 12.345")

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm_obrigatorio(v)

    @validator("termos_inclusao")
    def validate_inclusao(cls, v):
        limpos = normalizar_termos(v)
        if not limpos:
            raise ValueError("Informe ao menos um termo de inclusão")
        return limpos

    @validator("termos_exclusao")
    def validate_exclusao(cls, v):
        return normalizar_termos(v)

    @validator("aliquota")
    def validate_aliquota(cls, v):
        return normalizar_aliquota(v)

    class Config:
        extra = "forbid"


class RegraReducaoCreate(RegraReducaoBase):
    pass


class RegraReducaoUpdate(BaseModel):
    ncm: Optional[str] = None
    termos_inclusao: Optional[List[str]] = None
    termos_exclusao: Optional[List[str]] = None
    aliquota: Optional[Decimal] = None
    descricao: Optional[str] = None

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm_obrigatorio(v) if v is not None else v

    @validator("termos_inclusao")
    def validate_inclusao(cls, v):
        if v is None:
            return v
        limpos = normalizar_termos(v)
        if not limpos:
            raise ValueError("Informe ao menos um termo de inclusão")
        return limpos

    @validator("termos_exclusao")
    def validate_exclusao(cls, v):
        return normalizar_termos(v) if v is not None else v

    @validator("aliquota")
    def validate_aliquota(cls, v):
        return normalizar_aliquota(v)

    class Config:
        extra = "forbid"


class RegraReducaoOut(RegraReducaoBase):
    id: int
    excecoes: List[ExcecaoReducaoOut] = Field(default_factory=list)
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
