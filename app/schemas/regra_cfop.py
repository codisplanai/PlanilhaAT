import re
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, validator

from app.constants import DESTINOS_CFOP

# Compatibilidade pública: testes e integrações existentes importam este nome.
VALID_DESTINOS = list(DESTINOS_CFOP)

def clean_cfop_sufixo(v: str) -> str:
    cleaned = re.sub(r"\D", "", v or "")
    # Aceita CFOP completo de 4 dígitos (usa os 3 últimos) ou já o sufixo de 3 dígitos
    if len(cleaned) == 4:
        cleaned = cleaned[-3:]
    if len(cleaned) != 3:
        raise ValueError("CFOP deve ter 3 dígitos (sufixo) ou 4 dígitos (CFOP completo)")
    return cleaned

class RegraCfopBase(BaseModel):
    perfil_regras_id: Optional[int] = Field(None, example=1, description="Null = regra padrão global do sistema")
    cfop_sufixo: str = Field(..., example="102", description="3 últimos dígitos do CFOP (ex: 102, 405, 556)")
    destino: str = Field(..., example="antecipacao_parcial", description="antecipacao_parcial, antecipacao_tributaria, difal ou ignorar")
    descricao: Optional[str] = Field(None, example="Compra para comercialização")

    @validator("cfop_sufixo")
    def validate_cfop_sufixo(cls, v):
        return clean_cfop_sufixo(v)

    @validator("destino")
    def validate_destino(cls, v):
        clean = v.strip().lower()
        if clean not in VALID_DESTINOS:
            raise ValueError(f"destino deve ser um dos seguintes: {', '.join(VALID_DESTINOS)}")
        return clean

    class Config:
        extra = "forbid"

class RegraCfopCreate(RegraCfopBase):
    pass

class RegraCfopUpdate(BaseModel):
    cfop_sufixo: Optional[str] = None
    destino: Optional[str] = None
    descricao: Optional[str] = None

    @validator("cfop_sufixo")
    def validate_cfop_sufixo(cls, v):
        if v is None:
            return v
        return clean_cfop_sufixo(v)

    @validator("destino")
    def validate_destino(cls, v):
        if v is None:
            return v
        clean = v.strip().lower()
        if clean not in VALID_DESTINOS:
            raise ValueError(f"destino deve ser um dos seguintes: {', '.join(VALID_DESTINOS)}")
        return clean

    class Config:
        extra = "forbid"

class RegraCfopOut(RegraCfopBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True

class RegraCfopEfetivaOut(BaseModel):
    """Visão efetiva: padrões globais + sobrescritas de um perfil, com a origem marcada"""
    cfop_sufixo: str
    destino: str
    descricao: Optional[str] = None
    origem: str  # "global" | "perfil"
    regra_id: int
