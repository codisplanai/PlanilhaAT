from decimal import Decimal
from typing import Any, Dict, Optional
from app.services.calculation.base import BaseCalculator, CalculationResult, round_currency

class DifalCalculator(BaseCalculator):
    """
    Cálculo de DIFAL (Diferencial de Alíquota - Bahia / Base Dupla por Dentro):
    
    1. Regime Normal (aliq_simples == 'N'):
       Base ST = ((V.Total + IPI) - (V.Total * A.ORI)) / (1 - A.DST)
       Débito = Base ST * A.DST
       Crédito = V.Total * A.ORI
       Valor Devido = Débito - Crédito

    2. Simples Nacional sem crédito (aliq_simples == 'S'):
       Base ST = (V.Total + IPI) / (1 - A.DST)
       Débito = Base ST * A.DST
       Crédito = Base ST * A.ORI
       Valor Devido = Base ST * (A.DST - A.ORI)

    3. Simples Nacional com crédito informado (aliq_simples > 0):
       Base ST = ((V.Total + IPI) - (V.Total * Alíq.Simples)) / (1 - A.DST)
       Valor Devido = Base ST * (A.DST - A.ORI)
       Débito = Base ST * A.DST
       Crédito = Débito - Valor Devido
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
        aliq_simples = str(params.get("aliq_simples", "N")).strip().upper()

        # Normalizar alíquotas para decimais unitários (ex: 20.5% -> 0.205)
        dst_rate = a_dst if a_dst <= 1 else (a_dst / Decimal("100.0"))
        ori_rate = a_ori if a_ori <= 1 else (a_ori / Decimal("100.0"))

        divisor = Decimal("1.0") - dst_rate
        if divisor <= 0:
            divisor = Decimal("1.0")

        v_contabil = v_total
        ipi = ipi_despesas

        if aliq_simples == "S":
            # Simples Nacional sem destaque de crédito
            base_st = (v_contabil + ipi) / divisor
            valor_devido = round_currency(base_st * (dst_rate - ori_rate))
            debito = round_currency(base_st * dst_rate)
            credito = round_currency(base_st * ori_rate)
        elif aliq_simples not in ("", "N"):
            # Simples Nacional com alíquota numérica informada
            try:
                p_cred = Decimal(aliq_simples)
                if p_cred > 1:
                    p_cred = p_cred / Decimal("100.0")
            except Exception:
                p_cred = Decimal("0.0")

            base_st = ((v_contabil + ipi) - (v_contabil * p_cred)) / divisor
            valor_devido = round_currency(base_st * (dst_rate - ori_rate))
            debito = round_currency(base_st * dst_rate)
            credito = debito - valor_devido
        else:
            # Regime Normal ('N')
            base_st = ((v_contabil + ipi) - (v_contabil * ori_rate)) / divisor
            debito = round_currency(base_st * dst_rate)
            credito = round_currency(v_contabil * ori_rate)
            valor_devido = debito - credito

        return CalculationResult(
            debito=debito,
            credito=credito,
            valor_devido=valor_devido,
            detalhes={
                "tipo": "difal",
                "aliq_simples": aliq_simples,
                "base_st": str(round_currency(base_st)),
                "diferencial_aliquota": str(dst_rate - ori_rate)
            }
        )
