from datetime import datetime
from decimal import Decimal
import pytest
from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor
from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor


def test_xml_extraction_simples_e_origem_mercadoria():
    xml_content = b"""<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe>
        <infNFe Id="NFe35260112345678000195550010000001001000000100">
          <ide>
            <cUF>35</cUF>
            <nNF>100</nNF>
            <serie>1</serie>
            <dhEmi>2026-07-15T10:00:00-03:00</dhEmi>
          </ide>
          <emit>
            <CNPJ>12345678000195</CNPJ>
            <xNome>FORNECEDOR SIMPLES LTDA</xNome>
            <CRT>1</CRT>
            <enderEmit>
              <UF>SP</UF>
            </enderEmit>
          </emit>
          <dest>
            <CNPJ>98765432000100</CNPJ>
            <enderDest>
              <UF>BA</UF>
            </enderDest>
          </dest>
          <total>
            <ICMSTot>
              <vNF>1000.00</vNF>
              <vBC>0.00</vBC>
              <vICMS>0.00</vICMS>
            </ICMSTot>
          </total>
          <det nItem="1">
            <prod>
              <NCM>84713012</NCM>
              <CFOP>6102</CFOP>
              <xProd>NOTEBOOK IMPORTADO</xProd>
              <vProd>1000.00</vProd>
            </prod>
            <imposto>
              <ICMS>
                <ICMSSN102>
                  <orig>2</orig>
                  <CSOSN>102</CSOSN>
                </ICMSSN102>
              </ICMS>
            </imposto>
          </det>
        </infNFe>
      </NFe>
    </nfeProc>"""

    extractor = NFeXMLExtractor()
    nf = extractor.extract_from_xml(xml_content)

    assert nf.raw_metadata["crt"] == "1"
    assert nf.raw_metadata.get("fornecedor_simples_nacional") is True
    assert len(nf.itens) == 1
    item = nf.itens[0]
    assert item.origem_mercadoria == "2"
    assert item.csosn == "102"
    assert item.a_ori == Decimal("0.00")


def test_sped_extraction_simples_e_origem_mercadoria():
    sped_text = """|0000|014|0|01072026|31072026|EMPRESA DESTINATARIA|98765432000100||BA|123456789|2927408|||A|1|
|0150|FORN01|FORNECEDOR SIMPLES SP|1058|12345678000195||||3550308||
|0200|PROD01|PRODUTO IMPORTADO SIMPLES|||UN|01|84713012|||||||
|C100|0|1|FORN01|55|00|1|100|35260112345678000195550010000001001000000100|15072026|18072026|1000,00|0||0,00|1000,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|PROD01|PRODUTO IMPORTADO SIMPLES|1,000|UN|1000,00|0,00|0|1102|6102|PROD01|0,00|0,00|0,00|0|00||0,00|0,00|0,00|0,00|||0,00||0,00|0,00|||||||||
|9999|6|"""

    extractor = SpedFiscalExtractor()
    notas = extractor.extract_from_sped(sped_text.encode("utf-8"))

    assert len(notas) == 1
    nf = notas[0]
    assert nf.raw_metadata.get("fornecedor_simples_nacional") is True
    assert len(nf.itens) == 1
    item = nf.itens[0]
    assert item.csosn == "102"
    assert item.origem_mercadoria == "1"


def test_sped_propagacao_simples_nacional_mesmo_cnpj():
    # Duas notas do mesmo fornecedor (FORN01 / CNPJ 12345678000195):
    # Nota 100 tem C170 com CSOSN 102.
    # Nota 200 não tem C170, apenas C190.
    # Ambas devem ser marcadas como fornecedor_simples_nacional == True por propagação do CNPJ.
    sped_text = """|0000|014|0|01072026|31072026|EMPRESA DESTINATARIA|98765432000100||BA|123456789|2927408|||A|1|
|0150|FORN01|FORNECEDOR SIMPLES SP|1058|12345678000195||||3550308||
|0200|PROD01|PRODUTO SIMPLES|||UN|01|84713012|||||||
|C100|0|1|FORN01|55|00|1|100|35260112345678000195550010000001001000000100|15072026|18072026|1000,00|0||0,00|1000,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|PROD01|PRODUTO SIMPLES|1,000|UN|1000,00|0,00|0|102|6102|PROD01|0,00|0,00|0,00|0|00||0,00|0,00|0,00|0,00|||0,00||0,00|0,00|||||||||
|C100|0|1|FORN01|55|00|1|200|35260112345678000195550010000002001000000200|16072026|19072026|500,00|0||0,00|500,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C190|6102|0,00|500,00|0,00|0,00|0,00|0,00|0,00|
|9999|8|"""

    extractor = SpedFiscalExtractor()
    notas = extractor.extract_from_sped(sped_text.encode("utf-8"))

    assert len(notas) == 2
    assert notas[0].numero_nota == "100"
    assert notas[0].raw_metadata.get("fornecedor_simples_nacional") is True
    assert notas[1].numero_nota == "200"
    assert notas[1].raw_metadata.get("fornecedor_simples_nacional") is True
