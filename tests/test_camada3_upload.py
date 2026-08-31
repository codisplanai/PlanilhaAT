import pytest
from app.services.validation.sanity_checker import SanityChecker
from app.services.extraction.base import ExtractedNFData
from app.core.exceptions import ValidationException
from decimal import Decimal
from datetime import datetime

def test_validacao_upload_cnpj_destinatario():
    # Destinatário confere com a empresa solicitada
    nf_valida = ExtractedNFData(
        numero_nota="555",
        cnpj_destinatario="12345678000195",
        data_emissao=datetime(2026, 1, 15),
        v_total_nota=Decimal("1500.00"),
        v_bc_nota=Decimal("1500.00"),
        itens=[]
    )
    # Não deve levantar exceção
    SanityChecker.validate_nf_destinatario(nf_valida, "12.345.678/0001-95")

    # Destinatário de outra empresa
    with pytest.raises(ValidationException) as exc_info:
        SanityChecker.validate_nf_destinatario(nf_valida, "99999999000199")

    assert "não corresponde ao CNPJ da empresa selecionada" in str(exc_info.value)
