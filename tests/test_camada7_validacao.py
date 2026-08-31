import pytest
from datetime import date, datetime
from decimal import Decimal
from app.services.validation.sanity_checker import SanityChecker, validate_cnpj_digits
from app.services.extraction.base import ExtractedNFData
from app.core.exceptions import ValidationException

def test_validacao_cnpj():
    # CNPJ válido
    assert validate_cnpj_digits("12.345.678/0001-95") is True
    assert validate_cnpj_digits("12345678000195") is True

    # CNPJ com dígito verificador incorreto
    assert validate_cnpj_digits("12345678000199") is False

    # CNPJ com números repetidos
    assert validate_cnpj_digits("11111111111111") is False

    with pytest.raises(ValidationException):
        SanityChecker.validate_cnpj("12345678000199")

def test_validacao_destinatario_nf():
    nf = ExtractedNFData(
        numero_nota="101",
        cnpj_destinatario="12345678000195",
        data_emissao=datetime(2026, 1, 15),
        v_total_nota=Decimal("100.00"),
        v_bc_nota=Decimal("100.00"),
        itens=[]
    )
    # Sucesso quando coincide
    SanityChecker.validate_nf_destinatario(nf, "12345678000195")

    # Erro quando diverge da empresa solicitada
    with pytest.raises(ValidationException) as exc:
        SanityChecker.validate_nf_destinatario(nf, "98765432000180")
    assert "não corresponde ao CNPJ da empresa" in str(exc.value)

def test_validacao_periodo():
    dt = datetime(2026, 1, 15)
    # Dentro do período
    assert SanityChecker.is_within_period(dt, date(2026, 1, 1), date(2026, 1, 31)) is True
    SanityChecker.validate_period(dt, date(2026, 1, 1), date(2026, 1, 31), "101")

    # Fora do período
    assert SanityChecker.is_within_period(dt, date(2026, 2, 1), date(2026, 2, 28)) is False
    with pytest.raises(ValidationException) as exc:
        SanityChecker.validate_period(dt, date(2026, 2, 1), date(2026, 2, 28), "101")
    assert "está fora do período informado" in str(exc.value)

def test_validacao_valores_numericos():
    # V.Total <= 0 deve falhar
    with pytest.raises(ValidationException):
        SanityChecker.validate_numeric_values("101", Decimal("0.00"), Decimal("0.00"), Decimal("0.12"), Decimal("0.18"))

    # Alíquota fora de [0, 1] deve falhar
    with pytest.raises(ValidationException):
        SanityChecker.validate_numeric_values("101", Decimal("100.00"), Decimal("100.00"), Decimal("1.50"), Decimal("0.18"))
