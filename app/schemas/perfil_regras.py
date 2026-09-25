from typing import Optional, Dict, Any
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
import re
from pydantic import BaseModel, Field, validator


def _normalizar_lista_textos(value: Any, campo: str, *, ncm: bool = False) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{campo} deve ser uma lista")
    resultado: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ValueError(f"{campo} deve conter apenas textos")
        clean = re.sub(r"\D", "", item) if ncm else item.strip().upper()
        if ncm and len(clean) != 8:
            raise ValueError(f"NCM inválido '{item}' em {campo}; informe 8 dígitos")
        if not clean:
            raise ValueError(f"{campo} não pode conter valores vazios")
        if clean not in resultado:
            resultado.append(clean)
    return resultado


def _normalizar_mva(value: Any, campo: str) -> str:
    try:
        percentual = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError):
        raise ValueError(f"{campo} deve ser um percentual numérico válido")
    if percentual < 0 or percentual > 500:
        raise ValueError(f"{campo} deve estar entre 0% e 500%")
    return str(percentual.quantize(Decimal("0.01")))


def _validar_config_mva(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("mva_revenda_antecipacao_tributaria deve ser um objeto")

    enabled = value.get("enabled")
    if type(enabled) is not bool:
        raise ValueError("mva_revenda_antecipacao_tributaria.enabled deve ser booleano")

    cnpj = re.sub(r"\D", "", str(value.get("empresa_cnpj") or ""))
    if len(cnpj) != 14:
        raise ValueError("mva_revenda_antecipacao_tributaria.empresa_cnpj deve conter 14 dígitos")

    mvas = value.get("mvas")
    if not isinstance(mvas, dict):
        raise ValueError("mva_revenda_antecipacao_tributaria.mvas deve ser um objeto")

    normalized_mvas: Dict[str, Dict[str, str]] = {}
    for grupo in ("especial", "demais"):
        grupo_values = mvas.get(grupo)
        if not isinstance(grupo_values, dict):
            raise ValueError(f"mva_revenda_antecipacao_tributaria.mvas.{grupo} deve ser um objeto")
        normalized_mvas[grupo] = {}
        for faixa in ("4", "7", "12", "original"):
            if faixa not in grupo_values:
                raise ValueError(f"MVA '{faixa}' ausente no grupo '{grupo}'")
            normalized_mvas[grupo][faixa] = _normalizar_mva(
                grupo_values[faixa],
                f"mvas.{grupo}.{faixa}",
            )

    res = dict(value)
    res["enabled"] = enabled
    res["empresa_cnpj"] = cnpj
    res["special_ncms"] = _normalizar_lista_textos(
        value.get("special_ncms", []),
        "special_ncms",
        ncm=True,
    )
    res["description_fallback_ncms"] = _normalizar_lista_textos(
        value.get("description_fallback_ncms", []),
        "description_fallback_ncms",
        ncm=True,
    )
    res["special_keywords"] = _normalizar_lista_textos(
        value.get("special_keywords", []),
        "special_keywords",
    )
    res["exclusion_keywords"] = _normalizar_lista_textos(
        value.get("exclusion_keywords", []),
        "exclusion_keywords",
    )
    res["mvas"] = normalized_mvas
    return res



def _validar_config_convenio_52_91(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("convenio_icms_52_91_anexo_i deve ser um objeto")

    res = dict(value)
    for campo in (
        "enabled",
        "aplicar_automaticamente_seguros",
        "solicitar_confirmacao_duvidosos",
        "considerar_cst20_como_indicio",
    ):
        val = res.get(campo)
        if type(val) is not bool:
            raise ValueError(f"convenio_icms_52_91_anexo_i.{campo} deve ser booleano")
        res[campo] = val

    ajustes = res.get("ajustes", [])
    if not isinstance(ajustes, list):
        raise ValueError("convenio_icms_52_91_anexo_i.ajustes deve ser uma lista")

    normalized = []
    ids = set()
    for index, ajuste in enumerate(ajustes):
        if not isinstance(ajuste, dict):
            raise ValueError(f"ajustes[{index}] deve ser um objeto")

        ajuste_id = str(ajuste.get("id") or "").strip()
        if not ajuste_id:
            raise ValueError(f"ajustes[{index}].id é obrigatório")
        if ajuste_id in ids:
            raise ValueError(f"ID de ajuste duplicado: {ajuste_id}")
        ids.add(ajuste_id)

        ncm = re.sub(r"\D", "", str(ajuste.get("ncm") or ""))
        if len(ncm) != 8:
            raise ValueError(f"NCM inválido '{ajuste.get('ncm')}' em ajustes[{index}]; informe 8 dígitos")

        acao = str(ajuste.get("acao") or "").strip().lower()
        if acao not in {"automatico", "revisar", "nao_aplicar"}:
            raise ValueError(f"ajustes[{index}].acao deve ser automatico, revisar ou nao_aplicar")

        termos = _normalizar_lista_textos(
            ajuste.get("termos_descricao", []),
            f"ajustes[{index}].termos_descricao",
        )

        vigencia_inicio = ajuste.get("vigencia_inicio") or None
        vigencia_fim = ajuste.get("vigencia_fim") or None
        for campo_data, raw in (("vigencia_inicio", vigencia_inicio), ("vigencia_fim", vigencia_fim)):
            if raw is not None:
                try:
                    date.fromisoformat(str(raw))
                except (TypeError, ValueError):
                    raise ValueError(f"ajustes[{index}].{campo_data} deve usar AAAA-MM-DD")
        if vigencia_inicio and vigencia_fim and str(vigencia_fim) < str(vigencia_inicio):
            raise ValueError(f"ajustes[{index}].vigencia_fim não pode ser anterior à vigência inicial")

        normalized.append({
            **ajuste,
            "id": ajuste_id,
            "ncm": ncm,
            "acao": acao,
            "termos_descricao": termos,
            "vigencia_inicio": str(vigencia_inicio) if vigencia_inicio else None,
            "vigencia_fim": str(vigencia_fim) if vigencia_fim else None,
            "motivo": str(ajuste.get("motivo") or "").strip(),
        })

    res["ajustes"] = normalized
    return res


def _validar_e_normalizar_configuracoes_extras(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if value is None:
        return value
    if not isinstance(value, dict):
        raise ValueError("configuracoes_extras deve ser um objeto JSON (dicionário)")

    res = dict(value)

    if "politica_aliquotas_iguais_parcial" in res:
        politica = res["politica_aliquotas_iguais_parcial"]
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
                raise ValueError(
                    f"Valor para UF '{uf_k}' em politica_aliquotas_iguais_parcial "
                    "deve ser booleano estrito (true/false)"
                )
            normalized_politica[uf_clean] = val

        res["politica_aliquotas_iguais_parcial"] = normalized_politica

    if "mva_revenda_antecipacao_tributaria" in res:
        res["mva_revenda_antecipacao_tributaria"] = _validar_config_mva(
            res["mva_revenda_antecipacao_tributaria"]
        )

    if "convenio_icms_52_91_anexo_i" in res:
        res["convenio_icms_52_91_anexo_i"] = _validar_config_convenio_52_91(
            res["convenio_icms_52_91_anexo_i"]
        )

    return res


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
