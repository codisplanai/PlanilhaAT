"""Exclusão de ICMS ST na Antecipação Tributária para empresas específicas."""

from app.services.extraction.base import ExtractedNFData
from app.services.rules_engine.descricao_matcher import normalizar

COMPANIES = (
    "ARMAZEM COMERCIO",
    "ARMAZEM RECONCAVO",
    "ARMAZEM DO RECONCAVO",
    "BAHIA FERRO SALVADOR",
    "BAIA FERRO SALVADOR",
    "CASA VIP",
    "BAHIA FERRO FSA",
    "BAIA FERRO FSA",
    "BAHIA FERRO INDUSTRIAL",
    "BAIA FERRO INDUSTRIAL",
    "BAHIA FERRO INDUSTRIA",
    "BAIA FERRO INDUSTRIA",
    "BAHIA FERRO LAURO",
    "BAIA FERRO LAURO",
    "MERCAL",
    "MERCADAO SUPERMERCADO",
    "MERCADAO SUPERMECADO",
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
