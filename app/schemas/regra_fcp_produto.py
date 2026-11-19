from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, validator

from app.schemas.validators import (
    clean_ncm_prefixo_obrigatorio,
    clean_uf,
    normalizar_aliquota,
    normalizar_termos,
)
from app.services.rules_engine.descricao_matcher import normalizar


def _validar_aliquota_fcp(v: Optional[Decimal]) -> Optional[Decimal]:
    """Normaliza percentual (ex: 2 -> 0.02) e exige intervalo (0, 1]."""
    normalizada = normalizar_aliquota(v)
    if normalizada is None:
        return None
    if normalizada <= 0 or normalizada > 1:
        raise ValueError(
            "Alíquota de FCP deve ser maior que 0 e menor ou igual a 1 (ex: 0.0200)"
        )
    return normalizada


class ExcecaoFcpCreate(BaseModel):
    descricao_exata: str = Field(..., max_length=255, example="Água Mineral Natural")
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


class ExcecaoFcpOut(BaseModel):
    id: int
    regra_fcp_id: int
    descricao_exata: str
    enquadrado: bool
    observacao: Optional[str]
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True


class RegraFcpBase(BaseModel):
    perfil_regras_id: int = Field(..., example=1)
    uf: str = Field("BA", example="BA")
    ncm: str = Field(..., example="2203")
    termos_inclusao: List[str] = Field(default_factory=list, example=["refrigerant*"])
    termos_exclusao: List[str] = Field(default_factory=list, example=["agua mineral"])
    aliquota: Decimal = Field(..., example=0.0200)
    aplicar_com_termo_acordo: bool = True
    descricao: Optional[str] = Field(None, max_length=255)

    @validator("uf")
    def validate_uf(cls, v):
        limpa = clean_uf(v)
        if not limpa:
            raise ValueError("UF é obrigatória")
        return limpa

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm_prefixo_obrigatorio(v)

    @validator("termos_inclusao")
    def validate_inclusao(cls, v):
        return normalizar_termos(v)

    @validator("termos_exclusao")
    def validate_exclusao(cls, v):
        return normalizar_termos(v)

    @validator("aliquota")
    def validate_aliquota(cls, v):
        return _validar_aliquota_fcp(v)

    class Config:
        extra = "forbid"


class RegraFcpCreate(RegraFcpBase):
    pass


class RegraFcpUpdate(BaseModel):
    perfil_regras_id: Optional[int] = None
    uf: Optional[str] = None
    ncm: Optional[str] = None
    termos_inclusao: Optional[List[str]] = None
    termos_exclusao: Optional[List[str]] = None
    aliquota: Optional[Decimal] = None
    aplicar_com_termo_acordo: Optional[bool] = None
    descricao: Optional[str] = Field(None, max_length=255)

    @validator("uf")
    def validate_uf(cls, v):
        return clean_uf(v)

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm_prefixo_obrigatorio(v) if v is not None else v

    @validator("termos_inclusao")
    def validate_inclusao(cls, v):
        return normalizar_termos(v) if v is not None else v

    @validator("termos_exclusao")
    def validate_exclusao(cls, v):
        return normalizar_termos(v) if v is not None else v

    @validator("aliquota")
    def validate_aliquota(cls, v):
        return _validar_aliquota_fcp(v)

    class Config:
        extra = "forbid"


class RegraFcpOut(RegraFcpBase):
    id: int
    excecoes: List[ExcecaoFcpOut] = Field(default_factory=list)
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True


class PresetBebidasBaResultado(BaseModel):
    fcp_criadas: int
    fcp_ignoradas: int
    aliquotas_criadas: int
    aliquotas_ignoradas: int
