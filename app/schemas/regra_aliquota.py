import re
from typing import Optional, Dict, Any
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, Field, validator
from app.schemas.empresa import VALID_UFS

def clean_ncm(v: Optional[str]) -> Optional[str]:
    if v is None or v.strip() == "":
        return None
    cleaned = re.sub(r"\D", "", v)
    if len(cleaned) != 8:
        raise ValueError("NCM deve conter 8 dígitos ou ser vazio/nulo para regra padrão do estado")
    return cleaned

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
        if v < 0 or v > 1:
            # Se o usuário passou 18.0 em vez de 0.18, converter para decimal unitário
            if 1 < v <= 100:
                v = v / Decimal("100")
            else:
                raise ValueError("Alíquota deve estar entre 0 e 1 (ex: 0.1800)")
        return v

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

    class Config:
        extra = "forbid"

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm(v)

    @validator("aliquota")
    def validate_aliquota(cls, v):
        if v is not None:
            if v < 0 or v > 1:
                if 1 < v <= 100:
                    v = v / Decimal("100")
                else:
                    raise ValueError("Alíquota deve estar entre 0 e 1 (ex: 0.1800)")
        return v

class RegraAliquotaOut(RegraAliquotaBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
