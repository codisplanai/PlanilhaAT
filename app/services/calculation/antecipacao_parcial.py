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
        imposto_bruto = debito - credito

        is_simples = bool(
            parametros_extras and (
                parametros_extras.get("is_simples")
                or parametros_extras.get("optante_simples_nacional")
            )
        )

        if is_simples:
            if imposto_bruto > Decimal("0.00"):
                valor_devido = round_currency(imposto_bruto * Decimal("0.80"))
            else:
                valor_devido = imposto_bruto
        else:
            valor_devido = imposto_bruto

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
                "formula_valor_devido": "debito - credito" if not is_simples else "(debito - credito) * 0.80",
                "is_simples": is_simples,
                "reducao": "20%" if is_simples else "0%",
            }
        )
