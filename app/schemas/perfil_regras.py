from typing import Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, validator


def _validar_e_normalizar_configuracoes_extras(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if value is None:
        return value
    if not isinstance(value, dict):
        raise ValueError("configuracoes_extras deve ser um objeto JSON (dicionário)")

    if "politica_aliquotas_iguais_parcial" in value:
        politica = value["politica_aliquotas_iguais_parcial"]
        if not isinstance(politica, dict):
            raise ValueError("politica_aliquotas_iguais_parcial deve ser um mapeamento de UF para booleano")

        normalized_politica: Dict[str, bool] = {}
        for uf_k, val in politica.items():
            if not isinstance(uf_k, str):
                raise ValueError(f"UF inválida '{uf_k}' em politica_aliquotas_iguais_parcial")
            uf_clean = uf_k.strip().upper()
            if len(uf_clean) != 2 or not uf_clean.isalpha():
                raise ValueError(f"UF inválida '{uf_k}' em politica_aliquotas_iguais_parcial")
            if type(val) is not bool:
                raise ValueError(f"Valor para UF '{uf_k}' em politica_aliquotas_iguais_parcial deve ser booleano estrito (true/false)")
            normalized_politica[uf_clean] = val

        res = dict(value)
        res["politica_aliquotas_iguais_parcial"] = normalized_politica
        return res
    return value


class PerfilRegrasBase(BaseModel):
    nome: str = Field(..., max_length=100, example="Geral Comércio Bahia")
    descricao: Optional[str] = Field(None, example="Perfil padrão para empresas de comércio na BA")
    configuracoes_extras: Dict[str, Any] = Field(default_factory=dict)

    @validator("nome")
    def validate_name(cls, value):
        clean = value.strip()
        if not clean:
            raise ValueError("Nome não pode ser vazio")
        return clean

    @validator("configuracoes_extras")
    def validate_configuracoes_extras_base(cls, value):
        if value is None:
            return {}
        if not isinstance(value, dict):
            return {}
        return value

    class Config:
        extra = "forbid"


class PerfilRegrasCreate(PerfilRegrasBase):
    @validator("configuracoes_extras")
    def validate_configuracoes_extras_create(cls, value):
        return _validar_e_normalizar_configuracoes_extras(value)


class PerfilRegrasUpdate(BaseModel):
    nome: Optional[str] = Field(None, max_length=100)
    descricao: Optional[str] = None
    configuracoes_extras: Optional[Dict[str, Any]] = None

    @validator("nome")
    def validate_name(cls, value):
        if value is not None and not value.strip():
            raise ValueError("Nome não pode ser vazio")
        return value.strip() if value is not None else value

    @validator("configuracoes_extras")
    def validate_configuracoes_extras_update(cls, value):
        return _validar_e_normalizar_configuracoes_extras(value)

    class Config:
        extra = "forbid"


class PerfilRegrasOut(PerfilRegrasBase):
    id: int
    criado_em: datetime
    atualizado_em: datetime

    class Config:
        orm_mode = True


class PerfilRegrasDuplicar(BaseModel):
    nome: str = Field(..., min_length=1, max_length=100)

    @validator("nome")
    def validate_name(cls, value):
        clean = value.strip()
        if not clean:
            raise ValueError("Nome não pode ser vazio")
        return clean

    class Config:
        extra = "forbid"
