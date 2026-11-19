"""Exclusão de ICMS ST por item na Antecipação Tributária para empresas específicas."""

from app.services.extraction.base import ExtractedItemNF, ExtractedNFData
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
    "Antecipação Tributária excluída: ICMS ST já destacado no XML para este item "
    "(regra específica da empresa; frete do item fica fora da apuração)."
)


def should_exclude_st_item_from_tributaria(
    company_name: str, note: ExtractedNFData, item: ExtractedItemNF
) -> bool:
    """Exclui somente o item com vICMSST positivo comprovado no XML original."""
    normalized = normalizar(company_name or "")
    if not any(normalized == company or normalized.startswith(company + " ") for company in COMPANIES):
        return False
    # SPED isolado, CFOP 6.403 e reclassificação 6.102 -> 6.403 não provam ST paga.
    if "icms_st_xml" not in (note.raw_metadata or {}):
        return False
    return item.v_icms_st > 0
