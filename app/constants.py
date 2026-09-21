"""Vocabulário de domínio compartilhado pelo backend.

Este módulo mantém os identificadores persistidos e expostos pela API em um único
lugar. Os valores são strings por compatibilidade com o banco e com os clientes
existentes.
"""

from typing import Final


ANTECIPACAO_PARCIAL: Final = "antecipacao_parcial"
ANTECIPACAO_PARCIAL_ANTECIPADO: Final = "antecipacao_parcial_antecipado"
ANTECIPACAO_PARCIAL_SIMPLES: Final = "antecipacao_parcial_simples"
ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES: Final = "antecipacao_parcial_antecipado_simples"
ANTECIPACAO_TRIBUTARIA: Final = "antecipacao_tributaria"
ANTECIPACAO_TRIBUTARIA_ANTECIPADO: Final = "antecipacao_tributaria_antecipado"
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
    ANTECIPACAO_PARCIAL_SIMPLES,
    ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES,
    ANTECIPACAO_TRIBUTARIA,
    ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
    DIFAL,
)

DESTINOS_CFOP: Final = (*TIPOS_PLANILHA_LEGADO, IGNORAR)

UFS_BRASIL: Final = frozenset(
    {
        "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
        "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
        "RS", "RO", "RR", "SC", "SP", "SE", "TO",
    }
)

ROLE_ADMIN: Final = "admin"
ROLE_OPERADOR: Final = "operador"
CARGO_POR_ROLE: Final = {
    ROLE_ADMIN: "Contador Sênior",
    ROLE_OPERADOR: "Analista Fiscal",
}

STATUS_PENDENTE: Final = "pendente"
STATUS_PROCESSANDO: Final = "processando"
STATUS_CONCLUIDO: Final = "concluido"
STATUS_ERRO: Final = "erro"
