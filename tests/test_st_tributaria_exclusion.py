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


def test_st_total_exclui_casa_vip_e_baia_ferro_fsa():
    nf = NFeXMLExtractor().extract_from_xml(_xml(st_total="0.01"))
    for name in ("Casa VIP", "CASA VIP COMERCIO LTDA", "Baía Ferro FSA", "BAIA FERRO FSA LTDA"):
        assert should_exclude_st_from_tributaria(name, nf)


def test_st_total_exclui_todas_empresas_e_nomes_reais():
    nf = NFeXMLExtractor().extract_from_xml(_xml(st_total="0.01"))
    for name in (
        "ARMAZÉM COMÉRCIO DE MATERIAIS PARA CONSTRUÇÕES E FERRAGENS LTDA",
        "Armazém Recôncavo",
        "ARMAZEM DO RECONCAVO MATERIAIS PARA CONSTRUCAO LTDA",
        "BAHIA FERRO SALVADOR",
        "Baia Ferro Salvador",
        "CASA VIP COMÉRCIO DE PISOS E REVESTIMENTOS LTDA",
        "BAHIA FERRO FSA LTDA",
        "BAIA FERRO FSA LTDA",
        "Bahia Ferro Industrial",
        "Baia Ferro Industrial",
        "Bahia Ferro Lauro",
        "Mercal",
        "MERCADAO SUPERMERCADO LTDA",
        "MERCADÃO SUPERMERCADO ATACADO E VAREJO LTDA",
        "Mercadão Supermecado",
    ):
        assert should_exclude_st_from_tributaria(name, nf)


def test_st_no_item_tambem_exclui():
    nf = NFeXMLExtractor().extract_from_xml(_xml(st_item="0.02"))
    assert should_exclude_st_from_tributaria("Armazém Comércio", nf)


def test_st_no_item_exclui_novas_empresas():
    nf = NFeXMLExtractor().extract_from_xml(_xml(st_item="0.02"))
    for name in (
        "ARMAZEM DO RECONCAVO MATERIAIS PARA CONSTRUCAO LTDA",
        "Casa VIP",
        "BAHIA FERRO FSA LTDA",
        "Bahia Ferro Industrial",
        "Bahia Ferro Lauro",
        "Mercal",
        "MERCADAO SUPERMERCADO LTDA",
    ):
        assert should_exclude_st_from_tributaria(name, nf)


def test_sped_enriquecido_mantem_evidencia_st_do_xml():
    from app.services.pipeline_helpers import enrich_sped_with_xml

    xml_note = NFeXMLExtractor().extract_from_xml(_xml(st_total="5.00"))
    sped_note = NFeXMLExtractor().extract_from_xml(_xml())
    sped_note.origem_extracao = "sped"
    enrich_sped_with_xml(sped_note, xml_note)
    assert should_exclude_st_from_tributaria("Bahia Ferro Salvador", sped_note)


def test_sem_st_nao_exclui():
    nf = NFeXMLExtractor().extract_from_xml(_xml())
    for name in (
        "Armazém Comércio",
        "ARMAZEM DO RECONCAVO MATERIAIS PARA CONSTRUCAO LTDA",
        "Casa VIP",
        "BAHIA FERRO FSA LTDA",
        "Bahia Ferro Industrial",
        "Bahia Ferro Lauro",
        "Mercal",
        "MERCADAO SUPERMERCADO LTDA",
    ):
        assert not should_exclude_st_from_tributaria(name, nf)


def test_outras_empresas_nao_sao_afetadas():
    nf = NFeXMLExtractor().extract_from_xml(_xml(st_total="90.00"))
    for name in (
        "COMAPEL",
        "Armazém Outros",
        "Baia Ferro Feira",
        "Casa Vipera",
        "Baia Ferro FS",
        "Bahia Ferro FS",
        "MERCADÃO DE CARNES CARMO LTDA",
    ):
        assert not should_exclude_st_from_tributaria(name, nf)
