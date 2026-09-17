from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, validator

from app.schemas.validators import normalizar_aliquota


class TermoAcordoUpsert(BaseModel):
    aliquota: Decimal = Field(..., example=0.1206)
    descricao: Optional[str] = Field(None, max_length=255, example="Termo de Acordo nº 123/2025")

    @validator("aliquota")
    def validate_aliquota(cls, v):
        return normalizar_aliquota(v)

    class Config:
        extra = "forbid"


class TermoAcordoOut(BaseModel):
    id: int
    empresa_id: int
    aliquota: Decimal
    descricao: Optional[str]
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True
