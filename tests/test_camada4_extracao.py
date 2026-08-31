from decimal import Decimal
from datetime import datetime
from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor

def test_extracao_deterministica_nfe(sample_xml_nfe):
    extractor = NFeXMLExtractor()
    data = extractor.extract_from_xml(sample_xml_nfe)

    assert data.numero_nota == "1234"
    assert data.serie == "1"
    assert data.cnpj_emitente == "98765432000180"
    assert data.cnpj_destinatario == "12345678000195"
    assert data.data_emissao.year == 2026
    assert data.data_emissao.month == 1
    assert data.data_emissao.day == 15

    assert data.v_total_nota == Decimal("5400.00")
    assert data.v_bc_nota == Decimal("5150.00")

    assert len(data.itens) == 1
    item = data.itens[0]
    assert item.item_numero == 1
    assert item.ncm == "84713012"
    assert item.v_item == Decimal("5000.00")
    assert item.v_total == Decimal("5400.00")
    assert item.base_calculo == Decimal("5150.00")
    assert item.ipi_despesas == Decimal("400.00") # Frete 100 + Outro 50 + IPI 250
    # A.ORI extraída do XML: pICMS 12.00 -> 0.1200
    assert item.a_ori == Decimal("0.12")
