"""Leitura de dados estruturados nas Informações Complementares (infCpl) da NF-e."""
import re
import unicodedata
from decimal import Decimal
from typing import Optional

# "aliquota para credito de ICMS aproximadamente 3,59 %" (após remover acentos e caixa).
# Só esta frase autoriza o crédito; a sentença "NAO GERA DIREITO A CREDITO..." que
# costuma acompanhá-la é propositalmente ignorada.
_PADRAO_CREDITO_ICMS = re.compile(
    r"aliquota\s+(?:para\s+)?credito\s+(?:de\s+)?icms\D{0,40}?(\d{1,3}(?:[.,]\d{1,4})?)\s*%"
)


def _normalizar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return sem_acento.lower()


def extrair_aliquota_credito_icms(texto: Optional[str]) -> Optional[Decimal]:
    """Retorna a alíquota de crédito de ICMS em decimal (3,59% -> 0.0359), ou None."""
    if not texto:
        return None
    match = _PADRAO_CREDITO_ICMS.search(_normalizar(texto))
    if not match:
        return None
    percentual = Decimal(match.group(1).replace(",", "."))
    if percentual <= 0 or percentual > 100:
        return None
    return percentual / Decimal("100")
