from app.services.calculation.base import BaseCalculator
from app.services.calculation.antecipacao_parcial import AntecipacaoParcialCalculator
from app.services.calculation.antecipacao_tributaria import AntecipacaoTributariaCalculator
from app.services.calculation.difal import DifalCalculator
from app.core.exceptions import ValidationException
from app.constants import (
    ANTECIPACAO_PARCIAL,
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_TRIBUTARIA,
    DIFAL,
)

class CalculatorFactory:
    """Factory para instanciar a estratégia de cálculo correta conforme o tipo de planilha"""

    # 'antecipacao_parcial_antecipado' é a mesma apuração da parcial (Débito = V.Total × A.DST,
    # Crédito = Base × A.ORI); só o arquivo de saída é separado, para segregar as notas cuja
    # mercadoria ainda não entrou no estabelecimento. Por isso compartilha a MESMA instância.
    _parcial = AntecipacaoParcialCalculator()

    _calculators = {
        ANTECIPACAO_PARCIAL: _parcial,
        ANTECIPACAO_PARCIAL_ANTECIPADO: _parcial,
        ANTECIPACAO_TRIBUTARIA: AntecipacaoTributariaCalculator(),
        DIFAL: DifalCalculator(),
    }

    @classmethod
    def get_calculator(cls, tipo_planilha: str) -> BaseCalculator:
        clean_tipo = tipo_planilha.strip().lower()
        if clean_tipo not in cls._calculators:
            raise ValidationException(f"Tipo de planilha/cálculo não suportado: '{tipo_planilha}'. Opções: {list(cls._calculators.keys())}")
        return cls._calculators[clean_tipo]
