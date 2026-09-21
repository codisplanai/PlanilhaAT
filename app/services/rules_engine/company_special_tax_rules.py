import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, Optional

from app.core.exceptions import ValidationException
from app.services.rules_engine.descricao_matcher import casa_algum, normalizar


@dataclass(frozen=True)
class SpecialMvaResolution:
    applicable: bool
    value: Optional[Decimal] = None
    group: Optional[str] = None
    source: Optional[str] = None


class CompanySpecialTaxRules:
    """Regras tributárias especiais parametrizadas no perfil da empresa.

    A regra somente é aplicada quando o perfil contém a configuração
    antecipacao_tributaria_revenda habilitada e o CNPJ configurado coincide
    exatamente com a empresa em processamento.
    """

    CONFIG_KEY = "antecipacao_tributaria_revenda"

    @classmethod
    def _clean_cnpj(cls, value: Any) -> str:
        return re.sub(r"\D", "", str(value or ""))

    @classmethod
    def get_config(cls, empresa: Any) -> Dict[str, Any]:
        perfil = getattr(empresa, "perfil_regras", None)
        extras = getattr(perfil, "configuracoes_extras", None) or {}
        config = extras.get(cls.CONFIG_KEY) or {}
        if not isinstance(config, dict) or not config.get("enabled"):
            return {}

        expected_cnpj = cls._clean_cnpj(config.get("empresa_cnpj"))
        actual_cnpj = cls._clean_cnpj(getattr(empresa, "cnpj", ""))
        if not expected_cnpj or expected_cnpj != actual_cnpj:
            return {}
        return config

    @classmethod
    def route_revenda_to_tributaria(cls, empresa: Any, destino_atual: Optional[str]) -> bool:
        config = cls.get_config(empresa)
        if not config:
            return False
        destinos_revenda = set(config.get("destinos_revenda") or ["antecipacao_parcial"])
        return destino_atual in destinos_revenda

    @classmethod
    def _normalize_ncm(cls, ncm: Optional[str]) -> str:
        return re.sub(r"\D", "", str(ncm or ""))

    @classmethod
    def _normalize_a_ori_key(cls, a_ori: Optional[Decimal]) -> Optional[str]:
        if a_ori is None:
            return None
        try:
            value = Decimal(str(a_ori))
        except Exception:
            return None

        if value <= Decimal("1"):
            value *= Decimal("100")

        if Decimal("3.5") <= value <= Decimal("4.5"):
            return "4"
        if Decimal("6.5") <= value <= Decimal("7.5"):
            return "7"
        if Decimal("11.5") <= value <= Decimal("12.5"):
            return "12"
        return None

    @classmethod
    def classify_group(
        cls,
        *,
        config: Dict[str, Any],
        ncm: Optional[str],
        descricao: Optional[str],
        descricao_confiavel: bool,
    ) -> tuple[str, str]:
        clean_ncm = cls._normalize_ncm(ncm)
        desc_norm = normalizar(descricao) if descricao_confiavel else ""

        exclusion_terms = config.get("special_exclusion_terms") or []
        if desc_norm and casa_algum(desc_norm, exclusion_terms):
            return "demais", "descricao_exclusao"

        exact_ncms = {
            cls._normalize_ncm(value)
            for value in (config.get("special_ncms") or [])
            if cls._normalize_ncm(value)
        }
        if clean_ncm in exact_ncms:
            return "especial", "ncm_exato"

        fallback_ncms = {
            cls._normalize_ncm(value)
            for value in (config.get("description_fallback_ncms") or [])
            if cls._normalize_ncm(value)
        }
        fallback_terms = config.get("description_fallback_terms") or []
        if clean_ncm in fallback_ncms and desc_norm and casa_algum(desc_norm, fallback_terms):
            return "especial", "descricao_cinto_fallback"

        return "demais", "padrao_demais"

    @classmethod
    def resolve_mva(
        cls,
        *,
        empresa: Any,
        ncm: Optional[str],
        descricao: Optional[str],
        descricao_confiavel: bool,
        a_ori: Optional[Decimal],
        fornecedor_crt: Optional[str],
    ) -> SpecialMvaResolution:
        config = cls.get_config(empresa)
        if not config:
            return SpecialMvaResolution(applicable=False)

        group, source = cls.classify_group(
            config=config,
            ncm=ncm,
            descricao=descricao,
            descricao_confiavel=descricao_confiavel,
        )

        matrix = config.get("mva") or {}
        group_values = matrix.get(group) or {}
        if not isinstance(group_values, dict):
            raise ValidationException(
                f"Configuração de MVA inválida para o grupo '{group}' no perfil da empresa."
            )

        crt = str(fornecedor_crt or "").strip()
        if crt in {"1", "2"}:
            raw_value = group_values.get("original")
            if raw_value is None:
                raise ValidationException(
                    f"MVA original não configurada para o grupo '{group}' do fornecedor Simples Nacional."
                )
            return SpecialMvaResolution(
                applicable=True,
                value=Decimal(str(raw_value)),
                group=group,
                source=f"{source}:mva_original_simples",
            )

        ori_key = cls._normalize_a_ori_key(a_ori)
        if ori_key is None:
            raise ValidationException(
                "Alíquota de origem não suportada pela regra especial de MVA. "
                "São aceitas 4%, 7% ou 12% para fornecedor fora do Simples Nacional."
            )

        raw_value = group_values.get(ori_key)
        if raw_value is None:
            raise ValidationException(
                f"MVA não configurada para o grupo '{group}' e alíquota de origem {ori_key}%."
            )

        return SpecialMvaResolution(
            applicable=True,
            value=Decimal(str(raw_value)),
            group=group,
            source=f"{source}:a_ori_{ori_key}",
        )
