"""Vocabulário de domínio compartilhado pelo backend.

Este módulo mantém os identificadores persistidos e expostos pela API em um único
lugar. Os valores são strings por compatibilidade com o banco e com os clientes
existentes.
"""

from typing import Final


ANTECIPACAO_PARCIAL: Final = "antecipacao_parcial"
ANTECIPACAO_PARCIAL_ANTECIPADO: Final = "antecipacao_parcial_antecipado"
ANTECIPACAO_TRIBUTARIA: Final = "antecipacao_tributaria"
DIFAL: Final = "difal"
IGNORAR: Final = "ignorar"
MULTI: Final = "multi"

TIPOS_PLANILHA_LEGADO: Final = (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_TRIBUTARIA,
    DIFAL,
)

TIPOS_PLANILHA: Final = (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_TRIBUTARIA,
    DIFAL,
)

DESTINOS_CFOP: Final = (*TIPOS_PLANILHA_LEGADO, IGNORAR)

STATUS_PENDENTE: Final = "pendente"
STATUS_PROCESSANDO: Final = "processando"
STATUS_CONCLUIDO: Final = "concluido"
STATUS_ERRO: Final = "erro"
