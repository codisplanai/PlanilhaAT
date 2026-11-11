"""Exclusão de ICMS ST na Antecipação Tributária para empresas específicas."""

import re
import unicodedata

from app.services.extraction.base import ExtractedNFData

COMPANIES = (
    "ARMAZEM COMERCIO",
    "ARMAZEM RECONCAVO",
    "BAIA FERRO SALVADOR",
)

ST_TRIBUTARIA_EXCLUSION_REASON = (
    "Antecipação Tributária excluída: ICMS ST já destacado no XML da NF-e "
    "(regra específica da empresa, independentemente do valor pago)."
)


def _normalize_company_name(name: str) -> str:
    unaccented = "".join(
        char for char in unicodedata.normalize("NFD", name or "")
        if not unicodedata.combining(char)
    )
    return re.sub(r"[^A-Z0-9]+", " ", unaccented.upper()).strip()


def should_exclude_st_from_tributaria(company_name: str, note: ExtractedNFData) -> bool:
    """Só exclui a Tributária (normal/antecipada) se o XML declarou ST positiva."""
    normalized = _normalize_company_name(company_name)
    if not any(normalized == company or normalized.startswith(company + " ") for company in COMPANIES):
        return False
    return float((note.raw_metadata or {}).get("icms_st_xml") or 0) > 0
