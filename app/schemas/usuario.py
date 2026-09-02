from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, validator

from app.constants import CARGO_POR_ROLE, ROLE_OPERADOR


class UsuarioCreate(BaseModel):
    nome: str = Field(..., min_length=1, max_length=255, example="Maria Souza")
    email: str = Field(..., min_length=3, max_length=254, example="maria@codisplan.com")
    password: str = Field(..., min_length=8, max_length=256)
    role: str = Field(ROLE_OPERADOR, example=ROLE_OPERADOR)

    @validator("email")
    def validar_email(cls, value: str) -> str:
        clean = value.strip().lower()
        if clean.count("@") != 1 or clean.startswith("@") or clean.endswith("@"):
            raise ValueError("E-mail inválido")
        return clean

    @validator("nome")
    def validar_nome(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("Nome é obrigatório")
        return clean

    @validator("role")
    def validar_role(cls, value: str) -> str:
        clean = value.strip().lower()
        if clean not in CARGO_POR_ROLE:
            raise ValueError("Papel deve ser 'admin' ou 'operador'")
        return clean

    @property
    def cargo(self) -> str:
        return CARGO_POR_ROLE[self.role]

    class Config:
        extra = "forbid"


class UsuarioOut(BaseModel):
    id: Any
    nome: str
    email: str
    cargo: str
    role: str
    ativo: bool
    criado_em: Optional[datetime] = None

    class Config:
        orm_mode = True


class UsuarioStatusUpdate(BaseModel):
    ativo: bool

    class Config:
        extra = "forbid"
