from typing import Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field

class PerfilRegrasBase(BaseModel):
    nome: str = Field(..., max_length=100, example="Geral Comércio Bahia")
    descricao: Optional[str] = Field(None, example="Perfil padrão para empresas de comércio na BA")
    configuracoes_extras: Dict[str, Any] = Field(default_factory=dict)

class PerfilRegrasCreate(PerfilRegrasBase):
    pass

class PerfilRegrasUpdate(BaseModel):
    nome: Optional[str] = Field(None, max_length=100)
    descricao: Optional[str] = None
    configuracoes_extras: Optional[Dict[str, Any]] = None

class PerfilRegrasOut(PerfilRegrasBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
