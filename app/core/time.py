"""Utilitários de data/hora usados pelos modelos.

O banco atual armazena timestamps UTC sem informação de fuso. Centralizar a
conversão evita ``datetime.utcnow()``, removido nas versões futuras do Python,
sem mudar o formato persistido.
"""

from datetime import datetime, timezone


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
