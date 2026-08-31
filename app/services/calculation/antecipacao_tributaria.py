from decimal import Decimal
from typing import Any, Dict, Optional
from app.services.calculation.base import BaseCalculator, CalculationResult, round_currency

class AntecipacaoTributariaCalculator(BaseCalculator):
    """
    Cálculo de Antecipação Tributária (com encerramento de fase / ST):
      Base ST = (V.Total + IPI_Despesas) * (1 + MVA) [se MVA for configurado], ou V.Total
      Débito = Base ST × A.DST
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
        params = parametros_extras or {}
        mva_str = params.get("mva", "0.0")
        try:
            mva = Decimal(str(mva_str))
            if mva > 1:
                mva = mva / Decimal("100.0")
        except Exception:
            mva = Decimal("0.0")

        # Se houver MVA, adiciona sobre (v_total + ipi_despesas)
        if mva > 0:
            base_st = (v_total + ipi_despesas) * (Decimal("1.0") + mva)
        else:
            base_st = v_total + ipi_despesas if ipi_despesas > 0 else v_total

        debito = round_currency(base_st * a_dst)
        credito = round_currency(base_calculo * a_ori)
        valor_devido = debito - credito

        return CalculationResult(
            debito=debito,
            credito=credito,
            valor_devido=valor_devido,
            detalhes={
                "tipo": "antecipacao_tributaria",
                "mva_aplicado": str(mva),
                "base_st": str(round_currency(base_st))
            }
        )
