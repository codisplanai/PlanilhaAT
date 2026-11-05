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
# DIFAL de Simples Nacional cuja mercadoria ainda não deu entrada (mesmo RP-158).
DIFAL_ANTECIPADO: Final = "difal_antecipado"
# Planilha de controle (sem apuração): mercadorias excluídas da Parcial por
# "imposto pago na entrada". Mesmo layout da Parcial Pago Antecipadamente, com
# Valor pago (O) e Data de pagamento (P) preenchidos manualmente.
CONTROLE_IMPOSTO_PAGO_ENTRADA: Final = "controle_imposto_pago_entrada"
MOTIVO_IMPOSTO_PAGO_ENTRADA: Final = "imposto_pago_entrada"
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
    DIFAL_ANTECIPADO,
    CONTROLE_IMPOSTO_PAGO_ENTRADA,
)

DESTINOS_CFOP: Final = (*TIPOS_PLANILHA_LEGADO, IGNORAR)

UFS_BRASIL: Final = frozenset(
    {
        "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
        "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
        "RS", "RO", "RR", "SC", "SP", "SE", "TO",
    }
)

CSOSNS_SIMPLES: Final = frozenset(
    {"101", "102", "103", "201", "202", "203", "300", "400", "500", "900"}
)

# Item de Antecipação Tributária cuja MVA não pôde ser determinada pelo Anexo 1.
# Fica fora da planilha e aparece na conferência de itens excluídos para
# tratamento manual, em vez de ser calculado com MVA zero.
TIPO_EXCLUSAO_MVA_PENDENTE: Final = "mva_pendente"

# Item de empresa industrial que iria para Parcial ou Tributária: a indústria
# só gera DIFAL de uso/consumo e ativo imobilizado.
TIPO_EXCLUSAO_INDUSTRIA: Final = "industria_sem_antecipacao"

# Regime Normal: bonificação de uso/consumo sem entrada no período não entra na
# DIFAL agora; ela é apurada no mês da entrada (DIFAL retroativa), evitando pagar duas vezes.
MOTIVO_DIFAL_AGUARDANDO_ENTRADA: Final = (
    "Bonificação/amostra/outras entradas para uso/consumo sem entrada no período: "
    "no Regime Normal a DIFAL é apurada no mês da entrada (SPED)."
)
MOTIVO_EXCLUSAO_INDUSTRIA: Final = (
    "Empresa industrial: não recolhe Antecipação Parcial nem Tributária "
    "(apenas DIFAL de uso/consumo e ativo imobilizado)."
)

# Atividade da empresa: a indústria não recolhe Antecipação Parcial nem
# Tributária, apenas DIFAL de uso/consumo e ativo imobilizado.
ATIVIDADE_COMERCIO: Final = "comercio"
ATIVIDADE_INDUSTRIA: Final = "industria"
ATIVIDADES_EMPRESA: Final = (ATIVIDADE_COMERCIO, ATIVIDADE_INDUSTRIA)

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
