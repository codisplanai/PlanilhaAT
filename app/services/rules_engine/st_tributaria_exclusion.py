"""Exclusão de ICMS ST na Antecipação Tributária para empresas específicas."""

from app.services.extraction.base import ExtractedNFData
from app.services.rules_engine.descricao_matcher import normalizar

COMPANIES = (
    "ARMAZEM COMERCIO",
    "ARMAZEM RECONCAVO",
    "BAIA FERRO SALVADOR",
    "CASA VIP",
    "BAIA FERRO FSA",
)

ST_TRIBUTARIA_EXCLUSION_REASON = (
    "Antecipação Tributária excluída: ICMS ST já destacado no XML da NF-e "
    "(regra específica da empresa, independentemente do valor pago)."
)


def should_exclude_st_from_tributaria(company_name: str, note: ExtractedNFData) -> bool:
    """Só exclui a Tributária (normal/antecipada) se o XML declarou ST positiva."""
    normalized = normalizar(company_name or "")
    if not any(normalized == company or normalized.startswith(company + " ") for company in COMPANIES):
        return False
    return float((note.raw_metadata or {}).get("icms_st_xml") or 0) > 0
