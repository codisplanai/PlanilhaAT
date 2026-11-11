"""Regra excepcional de ICMS ST aplicada à Tributária, não às outras planilhas."""

from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor
from app.services.rules_engine.st_tributaria_exclusion import should_exclude_st_from_tributaria


def _xml(st_total="0.00", st_item="0.00"):
    return f"""<nfeProc><NFe><infNFe Id="NFe35260814515925000180550010000508831030783820">
      <ide><nNF>50883</nNF><serie>1</serie><dhEmi>2026-08-15T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>14515925000180</CNPJ><enderEmit><UF>SP</UF></enderEmit></emit>
      <dest><CNPJ>14064976000132</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>100.00</vNF><vST>{st_total}</vST></ICMSTot></total>
      <det nItem="1"><prod><NCM>84649090</NCM><CFOP>6403</CFOP><vProd>100.00</vProd></prod>
        <imposto><ICMS><ICMS10><pICMS>7.00</pICMS><vICMSST>{st_item}</vICMSST></ICMS10></ICMS></imposto>
      </det>
    </infNFe></NFe></nfeProc>""".encode()


def test_st_total_exclui_tres_empresas_independentemente_do_valor():
    nf = NFeXMLExtractor().extract_from_xml(_xml(st_total="0.01"))
    for name in ("Armazém Comércio", "ARMAZEM RECONCAVO LTDA", "Baia Ferro Salvador"):
        assert should_exclude_st_from_tributaria(name, nf)


def test_st_no_item_tambem_exclui():
    nf = NFeXMLExtractor().extract_from_xml(_xml(st_item="0.02"))
    assert should_exclude_st_from_tributaria("Armazém Comércio", nf)


def test_sem_st_nao_exclui():
    nf = NFeXMLExtractor().extract_from_xml(_xml())
    assert not should_exclude_st_from_tributaria("Armazém Comércio", nf)


def test_outras_empresas_nao_sao_afetadas():
    nf = NFeXMLExtractor().extract_from_xml(_xml(st_total="90.00"))
    for name in ("COMAPEL", "Armazém Outros", "Baia Ferro Feira"):
        assert not should_exclude_st_from_tributaria(name, nf)
