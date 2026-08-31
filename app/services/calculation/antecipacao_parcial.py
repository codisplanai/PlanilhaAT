from decimal import Decimal
from typing import Any, Dict, Optional
from app.services.calculation.base import BaseCalculator, CalculationResult, round_currency

class AntecipacaoParcialCalculator(BaseCalculator):
    """
    Cálculo de Antecipação Parcial de ICMS:
      Débito = V.Total × A.DST
      Crédito = Base de Cálculo × A.ORI
      Valor Devido = Débito − Crédito
    """

    def calculate(
        self,
        v_total: Decimal,
        base_calculo: Decimal,
        ipi_despesas: Decimal,
        a_ori: Decimal,
        a_dst: Decimal,
        parametros_extras: Optional[Dict[str, Any]] = None
    ) -> CalculationResult:
        debito = round_currency(v_total * a_dst)
        credito = round_currency(base_calculo * a_ori)
        valor_devido = debito - credito

        # Se valor devido for negativo (crédito superior a débito), na prática fiscal é zero ou saldo credor
        # Mantemos o valor aritmético com flag nos detalhes
        return CalculationResult(
            debito=debito,
            credito=credito,
            valor_devido=valor_devido,
            detalhes={
                "tipo": "antecipacao_parcial",
                "formula_debito": "v_total * a_dst",
                "formula_credito": "base_calculo * a_ori",
                "formula_valor_devido": "debito - credito"
            }
        )
