from typing import Optional, Dict, Any
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, Field, validator
from app.schemas.empresa import VALID_UFS
from app.schemas.validators import clean_ncm, normalizar_aliquota

# Reexportado: integrações e testes existentes importam clean_ncm daqui.
__all__ = ["clean_ncm", "RegraAliquotaBase", "RegraAliquotaCreate",
           "RegraAliquotaUpdate", "RegraAliquotaOut"]


class RegraAliquotaBase(BaseModel):
    perfil_regras_id: int = Field(..., example=1)
    uf: str = Field(..., min_length=2, max_length=2, example="BA")
    ncm: Optional[str] = Field(None, example="84713012", description="NCM de 8 dígitos ou null para regra padrão do estado")
    aliquota: Decimal = Field(..., example=0.1800, description="Alíquota decimal (ex: 0.1800 para 18%)")
    descricao: Optional[str] = Field(None, example="Alíquota padrão BA ou exceção Informática")
    parametros_extras: Dict[str, Any] = Field(default_factory=dict)

    @validator("uf")
    def validate_uf(cls, v):
        clean = v.strip().upper()
        if clean not in VALID_UFS:
            raise ValueError("UF inválida")
        return clean

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm(v)

    @validator("aliquota")
    def validate_aliquota(cls, v):
        return normalizar_aliquota(v)

    class Config:
        extra = "forbid"


class RegraAliquotaCreate(RegraAliquotaBase):
    pass


class RegraAliquotaUpdate(BaseModel):
    uf: Optional[str] = None
    ncm: Optional[str] = None
    aliquota: Optional[Decimal] = None
    descricao: Optional[str] = None
    parametros_extras: Optional[Dict[str, Any]] = None

    @validator("uf")
    def validate_uf(cls, v):
        if v is not None:
            clean = v.strip().upper()
            if clean not in VALID_UFS:
                raise ValueError("UF inválida")
            return clean
        return v

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm(v)

    @validator("aliquota")
    def validate_aliquota(cls, v):
        return normalizar_aliquota(v)

    class Config:
        extra = "forbid"


class RegraAliquotaOut(RegraAliquotaBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
