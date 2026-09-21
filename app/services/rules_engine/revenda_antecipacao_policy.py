import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, Mapping, Optional

from app.core.exceptions import ValidationException
from app.services.rules_engine.descricao_matcher import casa_algum, normalizar
from app.services.rules_engine.mva_resolver import MvaResolver


PROFILE_CONFIG_KEY = "mva_revenda_antecipacao_tributaria"

DEFAULT_SPECIAL_NCMS = {
    "42022100",
    "42022210",
    "42022220",
    "42022900",
    "42023100",
    "42023200",
    "42023900",
    "42033000",
    "64019990",
    "64021900",
    "64022000",
    "64029190",
    "64029990",
    "64035990",
    "64039190",
    "64039990",
    "64041100",
    "64041900",
    "64059000",
}

# NCMs genéricos encontrados em itens que podem ser cintos/acessórios. Eles só
# entram no grupo especial quando a descrição confiável confirma o produto.
DEFAULT_DESCRIPTION_FALLBACK_NCMS = {"61178090", "62171000", "63072000"}
DEFAULT_SPECIAL_KEYWORDS = ["CINTO", "CINTOS"]
DEFAULT_EXCLUSION_KEYWORDS = [
    "MOCHILA",
    "MOCHILAS",
    "MALA",
    "MALAS",
    "PASTA",
    "PASTAS",
    "NECESSAIRE",
    "NECESSAIRES",
    "PALMILHA",
    "PALMILHAS",
    "CALCANHEIRA",
    "CALCANHEIRAS",
]

DEFAULT_MVAS = {
    "especial": {
        "4": "61.81",
        "7": "56.75",
        "12": "48.33",
        "original": "34.00",
    },
    "demais": {
        "4": "69.06",
        "7": "63.77",
        "12": "54.97",
        "original": "40.00",
    },
}


@dataclass(frozen=True)
class MvaClassification:
    grupo: str
    fonte: str
    aviso: Optional[str] = None


class RevendaAntecipacaoTributariaPolicy:
    """Política configurável para perfis em que toda revenda vai para ST.

    A regra só fica ativa quando o perfil da empresa declara a chave
    mva_revenda_antecipacao_tributaria com enabled=true. Dessa forma nenhum
    outro cadastro é afetado.
    """

    @classmethod
    def config_from_profile(cls, configuracoes: Optional[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
        raw = (configuracoes or {}).get(PROFILE_CONFIG_KEY)
        if not isinstance(raw, dict) or raw.get("enabled") is not True:
            return None

        config = dict(raw)
        config.setdefault("special_ncms", sorted(DEFAULT_SPECIAL_NCMS))
        config.setdefault("description_fallback_ncms", sorted(DEFAULT_DESCRIPTION_FALLBACK_NCMS))
        config.setdefault("special_keywords", list(DEFAULT_SPECIAL_KEYWORDS))
        config.setdefault("exclusion_keywords", list(DEFAULT_EXCLUSION_KEYWORDS))
        config.setdefault("mvas", DEFAULT_MVAS)
        return config

    @staticmethod
    def _clean_ncm(ncm: Optional[str]) -> str:
        return re.sub(r"\D", "", str(ncm or ""))

    @classmethod
    def classify(
        cls,
        *,
        config: Mapping[str, Any],
        ncm: Optional[str],
        descricao: Optional[str],
        descricao_confiavel: bool,
    ) -> MvaClassification:
        clean_ncm = cls._clean_ncm(ncm)
        descricao_normalizada = normalizar(descricao if descricao_confiavel else "")
        exclusion_keywords = list(config.get("exclusion_keywords") or DEFAULT_EXCLUSION_KEYWORDS)

        if descricao_normalizada and casa_algum(descricao_normalizada, exclusion_keywords):
            return MvaClassification(
                grupo="demais",
                fonte="descricao_exclusao",
                aviso=(
                    f"NCM {clean_ncm or 'ausente'} mantido em 'demais produtos' porque a descrição "
                    "identifica mercadoria fora do grupo bolsas/cintos/calçados/carteiras."
                ),
            )

        special_ncms = {
            cls._clean_ncm(value)
            for value in (config.get("special_ncms") or DEFAULT_SPECIAL_NCMS)
            if cls._clean_ncm(value)
        }
        if clean_ncm in special_ncms:
            return MvaClassification(grupo="especial", fonte="ncm_exato")

        fallback_ncms = {
            cls._clean_ncm(value)
            for value in (config.get("description_fallback_ncms") or DEFAULT_DESCRIPTION_FALLBACK_NCMS)
            if cls._clean_ncm(value)
        }
        if clean_ncm in fallback_ncms:
            if not descricao_confiavel or not descricao_normalizada:
                return MvaClassification(
                    grupo="demais",
                    fonte="fallback_sem_descricao_confiavel",
                    aviso=(
                        f"NCM {clean_ncm} exige confirmação por descrição para entrar no grupo especial; "
                        "como a descrição não é confiável, foi usado o grupo 'demais produtos'."
                    ),
                )
            keywords = list(config.get("special_keywords") or DEFAULT_SPECIAL_KEYWORDS)
            if casa_algum(descricao_normalizada, keywords):
                return MvaClassification(
                    grupo="especial",
                    fonte="ncm_fallback_descricao",
                    aviso=f"NCM {clean_ncm} classificado como especial por confirmação da descrição do produto.",
                )
            return MvaClassification(grupo="demais", fonte="ncm_fallback_sem_match")

        return MvaClassification(grupo="demais", fonte="padrao")

    @classmethod
    def resolve_mva(
        cls,
        *,
        config: Mapping[str, Any],
        grupo: str,
        a_ori: Optional[Decimal],
        fornecedor_simples: bool,
    ) -> Decimal:
        mvas = config.get("mvas") or DEFAULT_MVAS
        group_values = mvas.get(grupo)
        if not isinstance(group_values, dict):
            raise ValidationException(f"Configuração de MVA inválida para o grupo '{grupo}'.")

        key = "original" if fornecedor_simples else MvaResolver._normalize_a_ori_key(a_ori)
        if key not in {"4", "7", "12", "original"}:
            raise ValidationException(
                f"Alíquota de origem '{a_ori}' não possui MVA parametrizada para este perfil."
            )

        value = group_values.get(key)
        if value is None:
            raise ValidationException(
                f"MVA '{key}' não configurada para o grupo '{grupo}'."
            )
        try:
            return Decimal(str(value))
        except Exception as exc:
            raise ValidationException(
                f"Valor de MVA inválido para o grupo '{grupo}' e faixa '{key}'."
            ) from exc
