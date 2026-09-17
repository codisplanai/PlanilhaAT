from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, validator

from app.schemas.validators import clean_ncm_obrigatorio
from app.services.rules_engine.descricao_matcher import normalizar

MOTIVOS_VALIDOS = {"isencao", "imposto_pago_entrada"}


def normalizar_termos_exclusao(termos: Optional[List[str]]) -> List[str]:
    """Normaliza cada palavra/termo obrigatório em maiúsculas sem acentos.

    Diferente de redução por produto, regras de exclusão de mercadoria usam
    correspondência exata de palavras completas, sem curingas (*).
    """
    limpos: List[str] = []
    for termo in termos or []:
        bruto = (termo or "").strip()
        if bruto.endswith("*"):
            bruto = bruto[:-1]
        alvo = normalizar(bruto)
        if not alvo:
            continue
        if alvo not in limpos:
            limpos.append(alvo)
    return limpos


class RegraExclusaoParcialBase(BaseModel):
    perfil_regras_id: int = Field(..., example=1)
    uf: str = Field(default="BA", example="BA")
    ncm: str = Field(..., example="02102000")
    descricao: Optional[str] = Field(None, max_length=255, example="Charque")
    termos_obrigatorios: List[str] = Field(..., example=["CHARQUE"])
    motivo: str = Field(..., example="imposto_pago_entrada")
    ativo: bool = Field(default=True)
    chave_origem: Optional[str] = Field(None, max_length=50, example="padrao_ba_charque")

    @validator("uf")
    def validate_uf(cls, v):
        clean = (v or "").strip().upper()
        if len(clean) != 2:
            raise ValueError("UF deve conter exatamente 2 caracteres")
        return clean

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm_obrigatorio(v)

    @validator("termos_obrigatorios")
    def validate_termos(cls, v):
        limpos = normalizar_termos_exclusao(v)
        if not limpos:
            raise ValueError("Informe ao menos um termo/palavra obrigatória")
        return limpos

    @validator("motivo")
    def validate_motivo(cls, v):
        clean = (v or "").strip().lower()
        if clean not in MOTIVOS_VALIDOS:
            raise ValueError(f"Motivo inválido. Deve ser um dos seguintes: {', '.join(sorted(MOTIVOS_VALIDOS))}")
        return clean

    class Config:
        extra = "forbid"


class RegraExclusaoParcialCreate(RegraExclusaoParcialBase):
    pass


class RegraExclusaoParcialUpdate(BaseModel):
    uf: Optional[str] = None
    ncm: Optional[str] = None
    descricao: Optional[str] = None
    termos_obrigatorios: Optional[List[str]] = None
    motivo: Optional[str] = None
    ativo: Optional[bool] = None
    chave_origem: Optional[str] = None

    @validator("uf")
    def validate_uf(cls, v):
        if v is None:
            return v
        clean = v.strip().upper()
        if len(clean) != 2:
            raise ValueError("UF deve conter exatamente 2 caracteres")
        return clean

    @validator("ncm")
    def validate_ncm(cls, v):
        return clean_ncm_obrigatorio(v) if v is not None else v

    @validator("termos_obrigatorios")
    def validate_termos(cls, v):
        if v is None:
            return v
        limpos = normalizar_termos_exclusao(v)
        if not limpos:
            raise ValueError("Informe ao menos um termo/palavra obrigatória")
        return limpos

    @validator("motivo")
    def validate_motivo(cls, v):
        if v is None:
            return v
        clean = v.strip().lower()
        if clean not in MOTIVOS_VALIDOS:
            raise ValueError(f"Motivo inválido. Deve ser um dos seguintes: {', '.join(sorted(MOTIVOS_VALIDOS))}")
        return clean

    class Config:
        extra = "forbid"


class RegraExclusaoParcialOut(RegraExclusaoParcialBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True


class CargaPadraoBAResponse(BaseModel):
    inseridas: int
    existentes: int
    total: int
    regras: List[RegraExclusaoParcialOut]
