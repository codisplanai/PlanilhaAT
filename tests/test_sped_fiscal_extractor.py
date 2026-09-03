import pytest
from datetime import date, datetime
from decimal import Decimal

from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor
from app.core.exceptions import ValidationException

SAMPLE_SPED_FISCAL = """|0000|019|0|01012026|31012026|EMPRESA DESTINATARIA TESTE LTDA|12345678000195||BA|123456789|2927408|||A|1|
|0001|0|
|0150|FORN01|FORNECEDOR SAO PAULO LTDA|1058|98765432000180||SP|3550308||RUA TESTE|100||CENTRO|
|0150|FORN02|FORNECEDOR MINAS GERAIS SA|1058|11223344000155||MG|3106200||AVENIDA MINAS|500||SAVASSI|
|0200|PROD01|NOTEBOOK CORPORATIVO CORE I7|||UN|01|84713012|||18,00||
|0200|PROD02|MOUSE OPTICO USB SEM FIO|||UN|01|84716053|||18,00||
|0200|PROD03|TECLADO MECANICO ABNT2|||UN|01|84716052|||18,00||
|0990|9|
|C001|0|
|C100|0|1|FORN01|55|00|1|1001|35260198765432000180550010000010011000123456|10012026|15012026|5500,00|0|0,00|0,00|5500,00|0|0,00|0,00|0,00|5500,00|660,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|PROD01|NOTEBOOK CORPORATIVO CORE I7|1,000|UN|5000,00|0,00|0|000|6102||5000,00|12,00|600,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|C170|2|PROD02|MOUSE OPTICO USB SEM FIO|5,000|UN|500,00|0,00|0|000|6102||500,00|12,00|60,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|C100|0|1|FORN02|55|00|1|2002|31260111223344000155550010000020021000654321|18012026|22012026|1200,00|0|0,00|0,00|1200,00|0|0,00|0,00|0,00|1200,00|48,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|PROD03|TECLADO MECANICO ABNT2|10,000|UN|1200,00|0,00|0|000|6102||1200,00|4,00|48,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|C100|1|0||55|00|1|9999|29260112345678000195550010000099991000999999|20012026|20012026|3000,00|0|0,00|3000,00|0|0,00|0,00|0,00|3000,00|540,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C100|0|1|FORN01|55|02|1|3003|35260198765432000180550010000030031000111111|25012026|25012026|1000,00|0|0,00|1000,00|0|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C990|10|
|9001|0|
|9999|25|
"""

def test_sped_fiscal_extractor_parsing_completo():
    extractor = SpedFiscalExtractor()
    notas = extractor.extract_from_sped(SAMPLE_SPED_FISCAL.encode("utf-8"))

    # Devem ser extraídas apenas as 2 notas válidas de entrada (1001 e 2002).
    # A nota 9999 foi ignorada por ser saída (IND_OPER=1)
    # A nota 3003 foi ignorada por ser cancelada (COD_SIT=02)
    assert len(notas) == 2

    # Nota 1: 1001
    n1 = notas[0]
    assert n1.numero_nota == "1001"
    assert n1.serie == "1"
    assert n1.chave_acesso == "35260198765432000180550010000010011000123456"
    assert n1.cnpj_emitente == "98765432000180"
    assert n1.cnpj_destinatario == "12345678000195"
    assert n1.data_emissao == datetime(2026, 1, 10, 0, 0)
    assert n1.data_entrada == date(2026, 1, 15)
    assert n1.v_total_nota == Decimal("5500.00")
    assert n1.v_bc_nota == Decimal("5500.00")
    assert n1.origem_extracao == "sped"

    # Itens da Nota 1 (cruzados com registro 0200)
    assert len(n1.itens) == 2
    assert n1.itens[0].item_numero == 1
    assert n1.itens[0].ncm == "84713012"
    assert n1.itens[0].descricao == "NOTEBOOK CORPORATIVO CORE I7"
    assert n1.itens[0].cfop == "6102"
    assert n1.itens[0].v_item == Decimal("5000.00")
    assert n1.itens[0].base_calculo == Decimal("5000.00")
    assert n1.itens[0].a_ori == Decimal("0.12") # 12%

    assert n1.itens[1].item_numero == 2
    assert n1.itens[1].ncm == "84716053"
    assert n1.itens[1].descricao == "MOUSE OPTICO USB SEM FIO"
    assert n1.itens[1].v_item == Decimal("500.00")
    assert n1.itens[1].a_ori == Decimal("0.12")

    # Nota 2: 2002
    n2 = notas[1]
    assert n2.numero_nota == "2002"
    assert n2.cnpj_emitente == "11223344000155"
    assert n2.data_emissao == datetime(2026, 1, 18, 0, 0)
    assert n2.data_entrada == date(2026, 1, 22)
    assert n2.v_total_nota == Decimal("1200.00")
    assert len(n2.itens) == 1
    assert n2.itens[0].ncm == "84716052"
    assert n2.itens[0].a_ori == Decimal("0.04") # 4% interestadual

def test_sped_fiscal_extractor_fallback_c190():
    sped_sem_c170 = """|0000|019|0|01012026|31012026|EMPRESA DESTINATARIA TESTE LTDA|12345678000195||BA|123456789|2927408|||A|1|
|0150|FORN01|FORNECEDOR SP LTDA|1058|98765432000180||SP|3550308||RUA TESTE|100||CENTRO|
|C100|0|1|FORN01|55|00|1|5005|35260198765432000180550010000050051000123456|12012026|17012026|2000,00|0|0,00|2000,00|0|0,00|0,00|0,00|2000,00|240,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C190|000|6102|12,00|2000,00|2000,00|240,00|0,00|0,00|0,00|0,00|
|9999|6|
"""
    extractor = SpedFiscalExtractor()
    notas = extractor.extract_from_sped(sped_sem_c170.encode("utf-8"))
    assert len(notas) == 1
    assert notas[0].numero_nota == "5005"
    assert len(notas[0].itens) == 1
    assert notas[0].itens[0].cfop == "6102"
    assert notas[0].itens[0].a_ori == Decimal("0.12")
    assert notas[0].itens[0].base_calculo == Decimal("2000.00")

def test_sped_fiscal_extractor_arquivo_vazio_ou_sem_entradas():
    extractor = SpedFiscalExtractor()
    with pytest.raises(ValidationException, match="está vazio"):
        extractor.extract_from_sped(b"")

    sped_apenas_saidas = """|0000|019|0|01012026|31012026|EMPRESA DESTINATARIA TESTE LTDA|12345678000195||BA|123456789|2927408|||A|1|
|C100|1|0||55|00|1|9999|29260112345678000195550010000099991000999999|20012026|20012026|3000,00|0|0,00|3000,00|0|0,00|0,00|0,00|3000,00|540,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|9999|4|
"""
    with pytest.raises(ValidationException, match="Nenhum documento fiscal de entrada"):
        extractor.extract_from_sped(sped_apenas_saidas.encode("utf-8"))


def test_item_vindo_do_c170_tem_descricao_confiavel():
    from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor
    from tests.conftest import _SPED_JANEIRO_COM_NF901

    notas = SpedFiscalExtractor().extract_from_sped(
        _SPED_JANEIRO_COM_NF901.encode("utf-8"))
    itens = [i for nf in notas for i in nf.itens]
    assert itens
    assert all(i.descricao_confiavel for i in itens)


def test_item_sintetico_do_c190_nao_e_confiavel():
    """Sem C170 não há descrição real de produto — só o analítico por CFOP."""
    from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor

    sped_so_c190 = (
        "|0000|019|0|01012026|31012026|Cliente BA|12345678000195||BA|123|2927408|||A|1|\n"
        "|0150|F1|FORNECEDOR SP|1058|98765432000180||SP|3550308||R|1||C|\n"
        "|C100|0|1|F1|55|00|1|901|35260198765432000180550010000009011000000901|"
        "10012026|20012026|2000,00|0|0,00|0,00|2000,00|0|0,00|0,00|0,00|2000,00|"
        "240,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|\n"
        "|C190|000|6102|12,00|2000,00|2000,00|240,00|0,00|0,00|0,00|0,00|0,00||\n"
        "|9999|4|\n"
    ).encode("utf-8")

    notas = SpedFiscalExtractor().extract_from_sped(sped_so_c190)
    itens = [i for nf in notas for i in nf.itens]
    assert itens
    assert all(not i.descricao_confiavel for i in itens)

