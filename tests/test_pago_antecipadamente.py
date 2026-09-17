from app.services.pipeline_service import ProcessingPipelineService

TIPOS = ("antecipacao_parcial", "antecipacao_parcial_antecipado", "difal")


def test_nota_ausente_do_sped_vai_para_planilha_separada(
        db_session, cenario_janeiro, xml_nf901, xml_nf902, sped_janeiro_com_nf901):
    """901 está no SPED (entrou em janeiro) -> planilha normal.
    902 não está (mercadoria ainda não entrou) -> Pago Antecipadamente."""
    sol = cenario_janeiro(tipos=TIPOS)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    destino_por_nota = {n.numero_nota: n.destino_planilha for n in res.notas_processadas}
    assert destino_por_nota["901"] == "antecipacao_parcial"
    assert destino_por_nota["902"] == "antecipacao_parcial_antecipado"

    saidas = {s.tipo: s for s in res.saidas}
    assert saidas["antecipacao_parcial"].arquivo_path is not None
    assert saidas["antecipacao_parcial"].total_notas == 1
    assert saidas["antecipacao_parcial_antecipado"].arquivo_path is not None
    assert saidas["antecipacao_parcial_antecipado"].total_notas == 1


def test_sem_sped_tudo_vai_para_a_planilha_normal(
        db_session, cenario_janeiro, xml_nf901, xml_nf902):
    """Sem SPED não há como saber o que entrou — 'ausente do SPED' não informa nada."""
    sol = cenario_janeiro(tipos=TIPOS)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id, xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)])
    db_session.refresh(res)

    assert {n.destino_planilha for n in res.notas_processadas} == {"antecipacao_parcial"}
    assert "antecipacao_parcial_antecipado" not in {s.tipo for s in res.saidas}


def test_difal_nao_se_desdobra_mesmo_ausente_do_sped(
        db_session, cenario_janeiro, xml_nf903_difal, sped_janeiro_com_nf901):
    """Só a Antecipação Parcial se desdobra; DIFAL vai para a planilha normal dele."""
    sol = cenario_janeiro(tipos=TIPOS)

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("903.xml", xml_nf903_difal)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    destino_por_nota = {n.numero_nota: n.destino_planilha for n in res.notas_processadas}
    assert destino_por_nota["903"] == "difal"


def test_modo_legado_nao_se_desdobra(
        db_session, cenario_janeiro, xml_nf901, xml_nf902, sped_janeiro_com_nf901):
    """Solicitação criada com tipo explícito mantém o comportamento antigo: uma planilha só."""
    sol = cenario_janeiro(tipos=TIPOS)
    sol.tipo_planilha = "antecipacao_parcial"
    db_session.commit()

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    assert {n.destino_planilha for n in res.notas_processadas} == {"antecipacao_parcial"}
