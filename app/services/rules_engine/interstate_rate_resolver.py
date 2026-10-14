"""Resolvedor determinístico de alíquotas de ICMS em operações interestaduais.

Baseado na legislação federal brasileira:
- Resolução do Senado Federal nº 22/1989 (Alíquotas interestaduais gerais: 7% e 12%).
- Resolução do Senado Federal nº 13/2012 (Alíquota interestadual para bens e mercadorias importados: 4%).
- CF/88 art. 155, § 2º, IV c/c ADCT art. 34, § 3º (Tratamento tributário do Espírito Santo equivalente às regiões N/NE).
"""

from decimal import Decimal
from typing import Final, Optional, Set, Union

from app.constants import UFS_BRASIL

# Estados do Sul e Sudeste cuja saída interestadual para N/NE/CO/ES é tributada a 7%.
# O Espírito Santo (ES) é excluído deste grupo porque tributa a 12% nas suas saídas para qualquer UF
# e recebe a 7% nas entradas originadas do Sul/Sudeste.
SUL_SUDESTE_ORIGEM_7: Final[Set[str]] = frozenset(
    {"SP", "RJ", "MG", "PR", "SC", "RS"}
)

# Origens da mercadoria (CST / CSOSN) que caracterizam mercadoria importada ou com conteúdo de importação > 40%:
# 1 - Estrangeira - Importação direta, exceto a indicada no código 6
# 2 - Estrangeira - Adquirida no mercado interno, exceto a indicada no código 7
# 3 - Nacional, mercadoria ou bem com Conteúdo de Importação superior a 40% e inferior ou igual a 70%
# 8 - Nacional, mercadoria ou bem com Conteúdo de Importação superior a 70%
ORIGENS_MERCADORIA_IMPORTADA: Final[Set[str]] = frozenset({"1", "2", "3", "8"})

ALIQUOTA_IMPORTADO: Final[Decimal] = Decimal("0.04")
ALIQUOTA_SUL_SUDESTE_PARA_NORTE_NORDESTE: Final[Decimal] = Decimal("0.07")
ALIQUOTA_INTERESTADUAL_PADRAO: Final[Decimal] = Decimal("0.12")


class InterstateRateResolver:
    """Resolve a alíquota interestadual aplicável (A.ORI) com base na UF de origem,

    UF de destino e código de origem da mercadoria.
    """

    @classmethod
    def resolve_rate(
        cls,
        uf_origem: str,
        uf_destino: str,
        origem_mercadoria: Optional[Union[str, int]] = None,
    ) -> Decimal:
        """Determina a alíquota de ICMS da operação interestadual.

        Args:
            uf_origem: Sigla da UF do emitente/fornecedor (ex: 'SP', 'BA').
            uf_destino: Sigla da UF do destinatário/adquirente (ex: 'BA', 'PE').
            origem_mercadoria: Código numérico da origem da mercadoria (dígito 0 a 8 do CST/CSOSN).

        Returns:
            Decimal: 0.04 (4%), 0.07 (7%) ou 0.12 (12%).

        Raises:
            ValueError: Se as UFs forem inválidas ou se a operação for interna estadual.
        """
        origem = (uf_origem or "").strip().upper()
        destino = (uf_destino or "").strip().upper()

        if origem not in UFS_BRASIL:
            raise ValueError(f"UF de origem inválida: '{uf_origem}'.")
        if destino not in UFS_BRASIL:
            raise ValueError(f"UF de destino inválida: '{uf_destino}'.")
        if origem == destino:
            raise ValueError(
                f"Operação interna estadual ({origem} -> {destino}). "
                f"A tabela interestadual aplica-se exclusivamente a operações entre estados distintos."
            )

        # 1. Regra de Mercadorias Importadas (Resolução do Senado nº 13/2012 -> 4%)
        if origem_mercadoria is not None:
            orig_str = str(origem_mercadoria).strip()
            if orig_str and orig_str[0] in ORIGENS_MERCADORIA_IMPORTADA:
                return ALIQUOTA_IMPORTADO

        # 2. Regra Geográfica: Sul/Sudeste (exceto ES) -> N/NE/CO/ES -> 7%
        if origem in SUL_SUDESTE_ORIGEM_7 and destino not in SUL_SUDESTE_ORIGEM_7:
            return ALIQUOTA_SUL_SUDESTE_PARA_NORTE_NORDESTE

        # 3. Demais operações interestaduais -> 12%
        return ALIQUOTA_INTERESTADUAL_PADRAO
