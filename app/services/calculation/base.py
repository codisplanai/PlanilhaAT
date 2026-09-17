from abc import ABC, abstractmethod
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field

class CalculationResult(BaseModel):
    debito: Decimal
    credito: Decimal
    valor_devido: Decimal
    detalhes: Dict[str, Any] = Field(default_factory=dict)

def round_currency(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

class BaseCalculator(ABC):
    """Interface abstrata para módulos de cálculo de tributação (desacoplados e substituíveis)"""

    @abstractmethod
    def calculate(
        self,
        v_total: Decimal,
        base_calculo: Decimal,
        ipi_despesas: Decimal,
        a_ori: Decimal,
        a_dst: Decimal,
        parametros_extras: Optional[Dict[str, Any]] = None
    ) -> CalculationResult:
        pass
