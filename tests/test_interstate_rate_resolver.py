from decimal import Decimal
import pytest
from app.services.rules_engine.interstate_rate_resolver import InterstateRateResolver

@pytest.mark.parametrize("uf_origem,uf_destino,origem_mercadoria,expected", [
    # Sul/Sudeste -> Norte/Nordeste/CO/ES = 7%
    ("SP", "BA", "0", Decimal("0.07")),
    ("RJ", "PE", None, Decimal("0.07")),
    ("PR", "ES", "0", Decimal("0.07")),
    ("RS", "GO", "0", Decimal("0.07")),
    ("MG", "AM", "0", Decimal("0.07")),
    ("SC", "MT", "0", Decimal("0.07")),
    # Sul/Sudeste -> Sul/Sudeste = 12%
    ("SP", "RJ", "0", Decimal("0.12")),
    ("PR", "SP", "0", Decimal("0.12")),
    ("RS", "SC", "0", Decimal("0.12")),
    # N/NE/CO/ES -> Qualquer UF = 12%
    ("BA", "SP", "0", Decimal("0.12")),
    ("PE", "BA", "0", Decimal("0.12")),
    ("GO", "MG", "0", Decimal("0.12")),
    ("AM", "RS", "0", Decimal("0.12")),
    ("ES", "RJ", "0", Decimal("0.12")),
    ("ES", "BA", "0", Decimal("0.12")),
    # Importados (Res. Senado 13/2012: origens 1, 2, 3, 8) = 4%
    ("SP", "BA", "1", Decimal("0.04")),
    ("RJ", "SP", "2", Decimal("0.04")),
    ("BA", "PE", "3", Decimal("0.04")),
    ("MG", "GO", "8", Decimal("0.04")),
    ("PR", "CE", 1, Decimal("0.04")),
])
def test_interstate_rate_resolution(uf_origem, uf_destino, origem_mercadoria, expected):
    rate = InterstateRateResolver.resolve_rate(
        uf_origem=uf_origem,
        uf_destino=uf_destino,
        origem_mercadoria=origem_mercadoria
    )
    assert rate == expected


def test_interstate_rate_invalid_ufs():
    with pytest.raises(ValueError, match="UF de origem inválida"):
        InterstateRateResolver.resolve_rate("XX", "BA")

    with pytest.raises(ValueError, match="UF de destino inválida"):
        InterstateRateResolver.resolve_rate("SP", "YY")


def test_interstate_rate_same_uf():
    with pytest.raises(ValueError, match="Operação interna estadual"):
        InterstateRateResolver.resolve_rate("BA", "BA")
