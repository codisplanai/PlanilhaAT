from decimal import Decimal
from app.services.extraction.base import ExtractedItemNF, ExtractedNFData

def test_dataclasses_suportam_v_desc():
    item = ExtractedItemNF(
        item_numero=1,
        ncm="12345678",
        cest="",
        cfop="6102",
        descricao="Teste",
        v_item=Decimal("8268.00"),
        v_total=Decimal("7275.84"),
        base_calculo=Decimal("7275.84"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.12"),
        p_cred_sn=Decimal("0.00"),
        v_icms=Decimal("873.10"),
        v_desc=Decimal("992.16"),
    )
    assert item.v_desc == Decimal("992.16")

    nota = ExtractedNFData(
        chave_acesso="35260000000000000000550010000012341000012345",
        numero_nota="1234",
        serie="1",
        cnpj_emitente="11111111000191",
        uf_emitente="SP",
        cnpj_destinatario="22222222000192",
        uf_destinatario="BA",
        data_emissao=None,
        data_entrada=None,
        v_total_nota=Decimal("7275.84"),
        v_bc_nota=Decimal("7275.84"),
        v_icms_nota=Decimal("873.10"),
        v_desc_nota=Decimal("992.16"),
        itens=[item],
    )
    assert nota.v_desc_nota == Decimal("992.16")


def test_xml_extractor_abate_desconto_quando_vbc_vem_bruto():
    from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor

    xml_content = b"""<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe Id="NFe35260000000000000000550010000012341000012345">
        <ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
        <dest><CNPJ>22222222000192</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
        <total><ICMSTot><vBC>8268.00</vBC><vICMS>992.16</vICMS><vProd>8268.00</vProd><vDesc>992.16</vDesc><vNF>7275.84</vNF></ICMSTot></total>
        <det nItem="1">
          <prod><cProd>1</cProd><xProd>MERCADORIA</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>8268.00</vProd><vDesc>992.16</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>8268.00</vBC><pICMS>12.00</pICMS><vICMS>992.16</vICMS></ICMS00></ICMS></imposto></det>
      </infNFe>
    </NFe>"""
    extractor = NFeXMLExtractor()
    data = extractor.extract_from_xml(xml_content)
    assert data.v_total_nota == Decimal("7275.84")
    assert data.v_desc_nota == Decimal("992.16")
    assert data.itens[0].v_total == Decimal("7275.84")
    assert data.itens[0].base_calculo == Decimal("7275.84")
    assert data.itens[0].v_desc == Decimal("992.16")


def test_xml_extractor_preserva_vbc_quando_ja_veio_liquido():
    from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor

    xml_content = b"""<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe Id="NFe35260000000000000000550010000012341000012346">
        <ide><nNF>1235</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
        <dest><CNPJ>22222222000192</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
        <total><ICMSTot><vBC>900.00</vBC><vICMS>108.00</vICMS><vProd>1000.00</vProd><vDesc>100.00</vDesc><vNF>900.00</vNF></ICMSTot></total>
        <det nItem="1">
          <prod><cProd>1</cProd><xProd>MERCADORIA</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>1000.00</vProd><vDesc>100.00</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>900.00</vBC><pICMS>12.00</pICMS><vICMS>108.00</vICMS></ICMS00></ICMS></imposto></det>
      </infNFe>
    </NFe>"""
    extractor = NFeXMLExtractor()
    data = extractor.extract_from_xml(xml_content)
    assert data.v_total_nota == Decimal("900.00")
    assert data.v_desc_nota == Decimal("100.00")
    assert data.itens[0].v_total == Decimal("900.00")
    assert data.itens[0].base_calculo == Decimal("900.00")


def test_xml_extractor_multiplos_itens_com_desconto():
    from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor

    xml_content = b"""<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
      <infNFe Id="NFe35260000000000000000550010000012341000012347">
        <ide><nNF>1236</nNF><serie>1</serie><dhEmi>2026-04-10T10:00:00-03:00</dhEmi></ide>
        <emit><CNPJ>11111111000191</CNPJ><CRT>3</CRT><enderEmit><UF>SP</UF></enderEmit></emit>
        <dest><CNPJ>22222222000192</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
        <total><ICMSTot><vBC>7200.00</vBC><vICMS>864.00</vICMS><vProd>8000.00</vProd><vDesc>800.00</vDesc><vNF>7200.00</vNF></ICMSTot></total>
        <det nItem="1">
          <prod><cProd>1</cProd><xProd>PROD 1</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>6000.00</vProd><vDesc>600.00</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>6000.00</vBC><pICMS>12.00</pICMS><vICMS>720.00</vICMS></ICMS00></ICMS></imposto></det>
        <det nItem="2">
          <prod><cProd>2</cProd><xProd>PROD 2</xProd><NCM>84189900</NCM><CFOP>6102</CFOP><vProd>2000.00</vProd><vDesc>200.00</vDesc></prod>
          <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1800.00</vBC><pICMS>12.00</pICMS><vICMS>216.00</vICMS></ICMS00></ICMS></imposto></det>
      </infNFe>
    </NFe>"""
    extractor = NFeXMLExtractor()
    data = extractor.extract_from_xml(xml_content)
    assert len(data.itens) == 2
    assert data.itens[0].base_calculo == Decimal("5400.00")
    assert data.itens[0].v_desc == Decimal("600.00")
    assert data.itens[1].base_calculo == Decimal("1800.00")
    assert data.itens[1].v_desc == Decimal("200.00")


def test_sped_fiscal_extractor_com_desconto_c170():
    from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor

    sped_lines = [
        "|0000|014|0|01042026|30042026|EMPRESA TESTE|12345678000195||BA|12345678||A|",
        "|0150|FORN1|FORNECEDOR SP|1058|11111111000191||||SP||",
        "|0200|PROD1|MERCADORIA|||UN|00|84189900|||||",
        "|C100|0|1|FORN1|55|00|1|1234|35260000000000000000550010000012341000012345|10042026|12042026|7275,84|1|992,16||0,00|0,00|0,00|8268,00|992,16|0,00|0,00|0,00|0,00|0,00|0,00|0,00|",
        "|C170|1|PROD1|MERCADORIA|1,000|UN|8268,00|992,16|0|000|6102||8268,00|12,00|992,16|||0,00|||||0,00||0,00|||||",
        "|9999|6|",
    ]
    sped_bytes = "\r\n".join(sped_lines).encode("latin1")
    extractor = SpedFiscalExtractor()
    notas = extractor.extract_from_sped(sped_bytes)
    assert len(notas) == 1
    nota = notas[0]
    assert nota.v_total_nota == Decimal("7275.84")
    assert nota.v_desc_nota == Decimal("992.16")
    assert nota.itens[0].v_total == Decimal("7275.84")
    assert nota.itens[0].base_calculo == Decimal("7275.84")
    assert nota.itens[0].v_desc == Decimal("992.16")
