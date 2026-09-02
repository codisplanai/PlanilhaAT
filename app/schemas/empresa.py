import re
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, validator

from app.constants import UFS_BRASIL

# Compatibilidade pública para integrações que importam este nome.
VALID_UFS = UFS_BRASIL

def clean_cnpj(v: str) -> str:
    cleaned = re.sub(r"\D", "", v)
    if len(cleaned) != 14:
        raise ValueError("CNPJ deve conter exatamente 14 dígitos")
    return cleaned

class EmpresaBase(BaseModel):
    razao_social: str = Field(..., max_length=255, example="Empresa Exemplo LTDA")
    cnpj: str = Field(..., example="12345678000195")
    inscricao_estadual: Optional[str] = Field(None, max_length=30, example="83592715")
    uf: str = Field(..., min_length=2, max_length=2, example="BA")
    perfil_regras_id: int = Field(..., example=1)
    ativo: bool = True

    @validator("cnpj")
    def validate_cnpj(cls, v):
        return clean_cnpj(v)

    @validator("uf")
    def validate_uf(cls, v):
        clean = v.strip().upper()
        if clean not in VALID_UFS:
            raise ValueError("UF inválida")
        return clean

    @validator("razao_social")
    def validate_name(cls, value):
        clean = value.strip()
        if not clean:
            raise ValueError("Razão social não pode ser vazia")
        return clean

    class Config:
        extra = "forbid"

class EmpresaCreate(EmpresaBase):
    pass

class EmpresaUpdate(BaseModel):
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    inscricao_estadual: Optional[str] = None
    uf: Optional[str] = None
    perfil_regras_id: Optional[int] = None
    ativo: Optional[bool] = None

    @validator("cnpj")
    def validate_cnpj(cls, v):
        if v is not None:
            return clean_cnpj(v)
        return v

    @validator("uf")
    def validate_uf(cls, v):
        if v is not None:
            clean = v.strip().upper()
            if clean not in VALID_UFS:
                raise ValueError("UF inválida")
            return clean
        return v

    @validator("razao_social")
    def validate_optional_name(cls, value):
        if value is not None and not value.strip():
            raise ValueError("Razão social não pode ser vazia")
        return value.strip() if value is not None else value

    class Config:
        extra = "forbid"

class EmpresaOut(EmpresaBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
