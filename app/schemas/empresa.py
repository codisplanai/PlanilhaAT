import re
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, validator

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
        return v.strip().upper()

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
            return v.strip().upper()
        return v

class EmpresaOut(EmpresaBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
