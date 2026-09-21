from app.services.calculation.base import BaseCalculator
from app.services.calculation.antecipacao_parcial import AntecipacaoParcialCalculator
from app.services.calculation.antecipacao_tributaria import AntecipacaoTributariaCalculator
from app.services.calculation.difal import DifalCalculator
from app.core.exceptions import ValidationException
from app.constants import (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_PARCIAL_SIMPLES,
    ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES,
    ANTECIPACAO_TRIBUTARIA,
    ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
    DIFAL,
)

class CalculatorFactory:
    """Factory para instanciar a estratégia de cálculo correta conforme o tipo de planilha"""

    # 'antecipacao_parcial_antecipado', 'antecipacao_parcial_simples' e 'antecipacao_parcial_antecipado_simples'
    # compartilham a mesma base da apuração parcial, aplicando a redução no calculator quando Simples.
    _parcial = AntecipacaoParcialCalculator()

    _calculators = {
        ANTECIPACAO_PARCIAL: _parcial,
        ANTECIPACAO_PARCIAL_ANTECIPADO: _parcial,
        ANTECIPACAO_PARCIAL_SIMPLES: _parcial,
        ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES: _parcial,
        ANTECIPACAO_TRIBUTARIA: AntecipacaoTributariaCalculator(),
        ANTECIPACAO_TRIBUTARIA_ANTECIPADO: AntecipacaoTributariaCalculator(),
        DIFAL: DifalCalculator(),
    }

    @classmethod
    def get_calculator(cls, tipo_planilha: str) -> BaseCalculator:
        clean_tipo = tipo_planilha.strip().lower()
        if clean_tipo not in cls._calculators:
            raise ValidationException(f"Tipo de planilha/cálculo não suportado: '{tipo_planilha}'. Opções: {list(cls._calculators.keys())}")
        return cls._calculators[clean_tipo]
