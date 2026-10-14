from decimal import Decimal
from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor
from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor

def test_xml_extractor_keeps_frete_out_of_ipi():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe>
        <infNFe Id="NFe35260198765432000180550010000001231000000123">
          <ide><nNF>123</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>98765432000180</CNPJ><enderEmit><UF>SP</UF></enderEmit><CRT>3</CRT></emit>
          <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
          <det nItem="1">
            <prod>
              <NCM>84713012</NCM><CFOP>6102</CFOP><xProd>ITEM TESTE</xProd>
              <vProd>1000.00</vProd><vFrete>100.00</vFrete><vSeg>0.00</vSeg><vOutro>50.00</vOutro><vDesc>0.00</vDesc>
            </prod>
            <imposto>
              <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1150.00</vBC><pICMS>12.00</pICMS><vICMS>138.00</vICMS></ICMS00></ICMS>
              <IPI><IPITrib><vIPI>50.00</vIPI></IPITrib></IPI>
            </imposto>
          </det>
          <total><ICMSTot><vBC>1150.00</vBC><vICMS>138.00</vICMS><vProd>1000.00</vProd><vFrete>100.00</vFrete><vSeg>0.00</vSeg><vOutro>50.00</vOutro><vIPI>50.00</vIPI><vNF>1200.00</vNF></ICMSTot></total>
        </infNFe>
      </NFe>
    </nfeProc>"""
    extractor = NFeXMLExtractor()
    data = extractor.extract_from_xml(xml.encode("utf-8"))
    assert len(data.itens) == 1
    item = data.itens[0]
    assert item.v_total == Decimal("1200.00")
    assert item.base_calculo == Decimal("1150.00")
    # IPI deve ser estritamente 50.00, NÃO 200.00 (50 IPI + 100 Frete + 50 Outro)
    assert item.ipi_despesas == Decimal("50.00")

def test_xml_extractor_zero_ipi_when_only_frete():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
      <NFe>
        <infNFe Id="NFe35260198765432000180550010000001241000000124">
          <ide><nNF>124</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>98765432000180</CNPJ><enderEmit><UF>SP</UF></enderEmit><CRT>3</CRT></emit>
          <dest><CNPJ>12345678000195</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
          <det nItem="1">
            <prod>
              <NCM>84713012</NCM><CFOP>6102</CFOP><xProd>ITEM COM FRETE SEM IPI</xProd>
              <vProd>1000.00</vProd><vFrete>100.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vDesc>0.00</vDesc>
            </prod>
            <imposto>
              <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1100.00</vBC><pICMS>12.00</pICMS><vICMS>132.00</vICMS></ICMS00></ICMS>
            </imposto>
          </det>
          <total><ICMSTot><vBC>1100.00</vBC><vICMS>132.00</vICMS><vProd>1000.00</vProd><vFrete>100.00</vFrete><vSeg>0.00</vSeg><vOutro>0.00</vOutro><vIPI>0.00</vIPI><vNF>1100.00</vNF></ICMSTot></total>
        </infNFe>
      </NFe>
    </nfeProc>"""
    extractor = NFeXMLExtractor()
    data = extractor.extract_from_xml(xml.encode("utf-8"))
    assert len(data.itens) == 1
    item = data.itens[0]
    assert item.v_total == Decimal("1100.00")
    assert item.base_calculo == Decimal("1100.00")
    assert item.ipi_despesas == Decimal("0.00")

def test_sped_extractor_keeps_frete_out_of_ipi():
    sped_text = """|0000|019|0|01012026|31012026|Cliente BA|12345678000195||BA|123|2927408|||A|1|
|0150|F1|FORNECEDOR SP|1058|98765432000180||SP|3550308||R|1||C|
|0200|P1|PRODUTO|||UN|01|84713012|||18,00||
|C100|0|1|F1|55|00|1|125|35260198765432000180550010000001251000000125|10012026|20012026|1100,00|0|0,00|0,00|1000,00|0|100,00|0,00|0,00|1100,00|132,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|C170|1|P1|PRODUTO|1,000|UN|1000,00|0,00|0|000|6102||1100,00|12,00|132,00|0,00|0,00|0,00|0|50|999|0,00|0,00|0,00|
|9999|5|
"""
    extractor = SpedFiscalExtractor()
    notas = extractor.extract_from_sped(sped_text.encode("utf-8"))
    assert len(notas) == 1
    item = notas[0].itens[0]
    # Em C170, vl_ipi é 0,00. O frete de 100,00 não pode ser jogado em ipi_despesas
    assert item.ipi_despesas == Decimal("0.00")
