from app.services.pipeline_service import ProcessingPipelineService


def test_nota_presente_nas_duas_fontes_nao_duplica(
        db_session, cenario_janeiro, xml_nf901, sped_janeiro_com_nf901):
    """A NF 901 está no XML e no SPED. Deve ser apurada UMA vez, não duas."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    numeros = [n.numero_nota for n in res.notas_processadas]
    assert numeros.count("901") == 1


def test_nota_so_no_xml_entra_na_apuracao(
        db_session, cenario_janeiro, xml_nf901, xml_nf902, sped_janeiro_com_nf901):
    """Antes desta task os XMLs eram descartados quando havia SPED. Agora a 902 tem que aparecer."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    assert sorted(n.numero_nota for n in res.notas_processadas) == ["901", "902"]


def test_nota_so_no_sped_entra_na_apuracao(
        db_session, cenario_janeiro, xml_nf902, sped_janeiro_com_nf901):
    """A 901 está só no SPED (XML não baixado da SEFAZ). Ela foi emitida e entrou em
    janeiro, então não pode sumir da apuração só porque faltou o XML."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    assert sorted(n.numero_nota for n in res.notas_processadas) == ["901", "902"]


def test_cruzamento_por_cnpj_serie_numero_quando_falta_a_chave(
        db_session, cenario_janeiro, xml_nf901, sped_janeiro_com_nf901):
    """Se a chave de acesso faltar no XML, o cruzamento cai para CNPJ+série+número.
    Sem essa reserva a mesma NF-e seria contada duas vezes e o imposto sairia em dobro."""
    from tests.conftest import CHAVE_NF901

    sol = cenario_janeiro()
    xml_sem_chave = xml_nf901.replace(f'Id="NFe{CHAVE_NF901}"'.encode(), b'Id=""')

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_sem_chave)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    numeros = [n.numero_nota for n in res.notas_processadas]
    assert numeros.count("901") == 1


def test_apenas_xmls_continua_funcionando(
        db_session, cenario_janeiro, xml_nf901, xml_nf902):
    """Quem só envia XML não deve notar diferença nenhuma."""
    sol = cenario_janeiro()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)])
    db_session.refresh(res)

    assert sorted(n.numero_nota for n in res.notas_processadas) == ["901", "902"]


def test_enriquecimento_ipi_do_xml_quando_presente_no_sped(
        db_session, cenario_janeiro, sped_janeiro_com_nf901):
    """
    Quando uma nota consta do SPED (sem IPI destacado pelo sistema contábil)
    e o XML da SEFAZ possui IPI/despesas, o processamento deve enriquecer a nota
    com o IPI do XML, preservando a data de entrada do SPED.
    """
    from tests.conftest import CHAVE_NF901, build_xml_nfe
    from decimal import Decimal

    sol = cenario_janeiro()
    # XML da 901 com R$ 100 de IPI e Base de Cálculo de R$ 1.000 (Total R$ 1.100)
    xml_901_com_ipi = build_xml_nfe(
        numero="901",
        chave=CHAVE_NF901,
        valor="1100.00",
        dia="10",
        cfop="6102",
        v_ipi="100.00",
        v_bc="1000.00"
    )

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_901_com_ipi)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    nota_901 = next(n for n in res.notas_processadas if n.numero_nota == "901")
    assert nota_901.origem_data_entrada == "sped_fiscal"
    assert nota_901.numero_nota == "901"
    assert nota_901.ipi_despesas == Decimal("100.00")

