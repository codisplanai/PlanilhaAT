"""Regra excepcional de ICMS ST aplicada à Tributária, não às outras planilhas."""

from app.services.extraction.nfe_xml_extractor import NFeXMLExtractor
from app.services.rules_engine.st_tributaria_exclusion import should_exclude_st_item_from_tributaria


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
        assert should_exclude_st_item_from_tributaria(name, nf, nf.itens[0])


def test_st_total_exclui_casa_vip_e_baia_ferro_fsa():
    nf = NFeXMLExtractor().extract_from_xml(_xml(st_total="0.01"))
    for name in ("Casa VIP", "CASA VIP COMERCIO LTDA", "Baía Ferro FSA", "BAIA FERRO FSA LTDA"):
        assert should_exclude_st_item_from_tributaria(name, nf, nf.itens[0])


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
        assert should_exclude_st_item_from_tributaria(name, nf, nf.itens[0])


def test_st_no_item_tambem_exclui():
    nf = NFeXMLExtractor().extract_from_xml(_xml(st_item="0.02"))
    assert should_exclude_st_item_from_tributaria("Armazém Comércio", nf, nf.itens[0])


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
        assert should_exclude_st_item_from_tributaria(name, nf, nf.itens[0])


def test_sped_enriquecido_mantem_evidencia_st_do_xml():
    from app.services.pipeline_helpers import enrich_sped_with_xml

    xml_note = NFeXMLExtractor().extract_from_xml(_xml(st_total="5.00"))
    sped_note = NFeXMLExtractor().extract_from_xml(_xml())
    sped_note.origem_extracao = "sped"
    enrich_sped_with_xml(sped_note, xml_note)
    assert should_exclude_st_item_from_tributaria("Bahia Ferro Salvador", sped_note, sped_note.itens[0])


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
        assert not should_exclude_st_item_from_tributaria(name, nf, nf.itens[0])


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
        assert not should_exclude_st_item_from_tributaria(name, nf, nf.itens[0])


def _mixed_xml(st_total="50.00", item_st="50.00"):
    """NF-e mista: item 1 ST pago + frete 30; item 2 CFOP 6102 sem ST + frete 20."""
    return f"""<nfeProc><NFe><infNFe Id="NFe35260114515925000180550010000508831030783820">
      <ide><nNF>50883</nNF><serie>1</serie><dhEmi>2026-01-15T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>14515925000180</CNPJ><enderEmit><UF>SP</UF></enderEmit><CRT>3</CRT></emit>
      <dest><CNPJ>14064976000132</CNPJ><enderDest><UF>BA</UF></enderDest></dest>
      <total><ICMSTot><vNF>550.00</vNF><vBC>550.00</vBC><vFrete>50.00</vFrete><vST>{st_total}</vST></ICMSTot></total>
      <det nItem="1"><prod><NCM>73269090</NCM><CFOP>6403</CFOP><xProd>PRODUTO ST PAGO</xProd><vProd>300.00</vProd><vFrete>30.00</vFrete></prod>
        <imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vBC>330.00</vBC><pICMS>12.00</pICMS><vICMSST>{item_st}</vICMSST></ICMS10></ICMS></imposto>
      </det>
      <det nItem="2"><prod><NCM>73269090</NCM><CFOP>6102</CFOP><xProd>GRAMPO ACO SEM ST PAGA</xProd><vProd>200.00</vProd><vFrete>20.00</vFrete></prod>
        <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>220.00</vBC><pICMS>12.00</pICMS><vICMS>26.40</vICMS></ICMS00></ICMS></imposto>
      </det>
    </infNFe></NFe></nfeProc>""".encode()


def test_nfe_mista_exclui_somente_item_st_e_preserva_frete_do_outro():
    nf = NFeXMLExtractor().extract_from_xml(_mixed_xml())
    assert [it.v_total for it in nf.itens] == [330, 220]
    assert [it.v_icms_st for it in nf.itens] == [50, 0]
    assert should_exclude_st_item_from_tributaria("Armazém Comércio", nf, nf.itens[0])
    # Reclassificar para 6403 NÃO cria imposto pago.
    nf.itens[1].cfop = "6403"
    assert not should_exclude_st_item_from_tributaria("Armazém Comércio", nf, nf.itens[1])


def test_total_st_sem_identificacao_por_item_nao_exclui_nfe_mista():
    nf = NFeXMLExtractor().extract_from_xml(_mixed_xml(item_st="0.00"))
    assert nf.raw_metadata["icms_st_xml"] == 50.0
    assert all(it.v_icms_st == 0 for it in nf.itens)
    assert all(
        not should_exclude_st_item_from_tributaria("Casa VIP", nf, it)
        for it in nf.itens
    )


def test_sped_sem_xml_nao_comprova_st_paga_em_item():
    nf = NFeXMLExtractor().extract_from_xml(_mixed_xml())
    nf.origem_extracao = "sped"
    nf.raw_metadata.pop("icms_st_xml")
    assert not should_exclude_st_item_from_tributaria("Baia Ferro FSA", nf, nf.itens[0])


def test_pipeline_nfe_mista_reclassificada_mantem_valor_da_mercadoria_e_frete(
    db_session, cenario_janeiro, monkeypatch
):
    from app.models.empresa import Empresa
    from app.models.nota_fiscal import NotaFiscalProcessada
    from app.models.regra_cfop import RegraCfopDestino
    from app.models.regra_reclassificacao_cfop import RegraReclassificacaoCfop
    from app.services.pipeline_service import ProcessingPipelineService
    from app.services.pipeline_cte import avaliar_nfe_para_cte

    solicitacao = cenario_janeiro(tipos=("antecipacao_parcial", "antecipacao_tributaria"))
    empresa = db_session.query(Empresa).filter_by(id=solicitacao.empresa_id).one()
    empresa.razao_social = "Armazém Comércio LTDA"
    db_session.add_all([
        RegraCfopDestino(perfil_regras_id=empresa.perfil_regras_id, cfop_sufixo="102", destino="antecipacao_parcial"),
        RegraCfopDestino(perfil_regras_id=empresa.perfil_regras_id, cfop_sufixo="403", destino="antecipacao_tributaria"),
        RegraReclassificacaoCfop(
            perfil_regras_id=empresa.perfil_regras_id, ncm="73269090",
            cfop_origem_sufixo="102", cfop_destino_sufixo="403",
            termos_inclusao=["GRAMPO*"], descricao="Reclassificar grampo para ST",
        ),
    ])
    db_session.commit()

    nf = NFeXMLExtractor().extract_from_xml(_mixed_xml())
    nf.cnpj_destinatario = empresa.cnpj
    pipeline = ProcessingPipelineService(db_session)

    # CT-e: somente 220/550 da base de transporte é tributável, sem
    # transferir a parcela do item com ST paga aos demais.
    cte_ctx = avaliar_nfe_para_cte(
        pipeline=pipeline, nf_data=nf.copy(deep=True), filename="50883.xml",
        empresa=empresa, planilha_records=[], has_sped=False, modo_legado=False,
        configuracoes_perfil={}, revenda_tributaria_config=None,
        is_industria=False, decisoes_bonificacao=None,
    )
    assert cte_ctx["soma_trib"] == 220
    assert cte_ctx["todos_itens_tributaria"] is False

    monkeypatch.setattr(
        pipeline.source_loader, "load",
        lambda **kw: type("Sources", (), {
            "notes": [("50883.xml", nf)],
            "entry_records": {}, "sped_company_info": None, "ignored_notes": [],
        })(),
    )
    result = pipeline.process_solicitacao(
        solicitacao_id=solicitacao.id,
        xml_files_bytes=[("50883.xml", _mixed_xml())],
    )
    assert result.status == "concluido"
    notas = db_session.query(NotaFiscalProcessada).filter_by(solicitacao_id=solicitacao.id).all()
    assert len(notas) == 1
    assert notas[0].destino_planilha == "antecipacao_tributaria"
    assert notas[0].cfop == "6403"
    assert notas[0].v_total == 220
    assert notas[0].base_calculo == 220
    assert notas[0].ipi_despesas == 0
    assert notas[0].valor_devido > 0


def test_cte_fob_st_complementa_apenas_frete(db_session, cenario_janeiro):
    from decimal import Decimal
    from app.models.empresa import Empresa
    from app.models.regra_cfop import RegraCfopDestino
    from app.services.pipeline_service import ProcessingPipelineService
    from app.services.pipeline_cte import avaliar_nfe_para_cte

    solicitacao = cenario_janeiro(tipos=("antecipacao_tributaria",))
    empresa = db_session.query(Empresa).filter_by(id=solicitacao.empresa_id).one()
    empresa.razao_social = "Bahia Ferro Salvador"
    db_session.add(RegraCfopDestino(perfil_regras_id=empresa.perfil_regras_id, cfop_sufixo="403", destino="antecipacao_tributaria"))
    db_session.commit()
    xml = _xml(st_total="22.73", st_item="22.73").replace(
        b"<total>", b"<transp><modFrete>1</modFrete></transp><total>"
    ).replace(b"<vNF>100.00</vNF>", b"<vNF>122.73</vNF><vFrete>0.00</vFrete>").replace(
        b"<vICMSST>", b"<modBCST>4</modBCST><pMVAST>45.00</pMVAST><vBCST>145.00</vBCST><pICMSST>20.50</pICMSST><vICMSST>"
    )
    pipeline = ProcessingPipelineService(db_session)
    reduced = xml.replace(b"<vBCST>145.00", b"<pRedBCST>41.46</pRedBCST><vBCST>84.88")
    for document, eligible in ((xml, True), (reduced, True), (xml.replace(b"<vBCST>145.00", b"<vBCST>174.00"), False)):
        nf = NFeXMLExtractor().extract_from_xml(document)
        nf.cnpj_destinatario = empresa.cnpj
        assert should_exclude_st_item_from_tributaria(empresa.razao_social, nf, nf.itens[0])
        assert nf.itens[0].frete_fob_st_mva == (Decimal("45.00") if eligible else None)
        ctx = avaliar_nfe_para_cte(
            pipeline=pipeline, nf_data=nf, filename="fob.xml",
            empresa=empresa, planilha_records=[], has_sped=False, modo_legado=False,
            configuracoes_perfil={}, revenda_tributaria_config=None,
            is_industria=False, decisoes_bonificacao=None,
        )
        assert ctx["todos_itens_tributaria"] is eligible
        if eligible:
            assert ctx["trib_candidates"][0]["mva"] == Decimal("45.00")
            if document == reduced:
                assert nf.itens[0].frete_fob_st_reducao == Decimal("0.4146")
                assert ctx["trib_candidates"][0]["reducao"] == Decimal("0.4146")
        else:
            assert ctx["soma_trib"] == 0
