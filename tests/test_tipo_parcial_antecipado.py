from app.services.calculation.factory import CalculatorFactory
from app.services.calculation.antecipacao_parcial import AntecipacaoParcialCalculator
from app.models.template_xlsx import TemplateXlsx
from app.core.seeds import seed_default_templates


def test_factory_reaproveita_o_calculador_da_parcial():
    """O cálculo é idêntico ao da Antecipação Parcial: mesma instância, não uma cópia."""
    parcial = CalculatorFactory.get_calculator("antecipacao_parcial")
    antecipado = CalculatorFactory.get_calculator("antecipacao_parcial_antecipado")

    assert isinstance(antecipado, AntecipacaoParcialCalculator)
    assert antecipado is parcial


def test_template_manager_aceita_o_tipo_novo(db_session, create_sample_excel_template):
    from app.services.templates_admin.template_manager import TemplateManager

    template_path = create_sample_excel_template(tipo="antecipacao_parcial_antecipado")
    with open(template_path, "rb") as f:
        file_bytes = f.read()

    template = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial_antecipado",
        filename="t.xlsx",
        file_bytes=file_bytes,
        mapeamento={"start_row": 4, "columns": {"numero_nota": "A", "v_total": "D"}},
        promover_ativo=True,
    )
    assert template.tipo == "antecipacao_parcial_antecipado"
    assert template.ativo is True


def test_seed_registra_template_ativo_para_o_tipo_novo(db_session):
    """O tipo novo reaproveita o arquivo-modelo da Parcial, então já nasce utilizável."""
    seed_default_templates(db_session)

    ativo = (
        db_session.query(TemplateXlsx)
        .filter(
            TemplateXlsx.tipo == "antecipacao_parcial_antecipado",
            TemplateXlsx.ativo == True,
        )
        .first()
    )
    assert ativo is not None


def test_regras_de_cfop_nao_oferecem_o_tipo_novo():
    """CFOP não sabe nada sobre data de entrada — o tipo novo não é destino de regra de CFOP."""
    from app.schemas.regra_cfop import VALID_DESTINOS

    assert "antecipacao_parcial_antecipado" not in VALID_DESTINOS


def test_nota_em_parcial_antecipado_tem_data_entrada_nula(
    db_session, cenario_janeiro, xml_nf901, xml_nf902, sped_janeiro_com_nf901
):
    """Notas ausentes do SPED são classificadas como Parcial Antecipado e NÃO possuem data de entrada."""
    from app.constants import ANTECIPACAO_PARCIAL, ANTECIPACAO_PARCIAL_ANTECIPADO
    from app.services.pipeline_service import ProcessingPipelineService

    sol = cenario_janeiro()
    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    notas_por_num = {n.numero_nota: n for n in res.notas_processadas}
    
    # 901 estava no SPED (deu entrada):
    assert notas_por_num["901"].destino_planilha == ANTECIPACAO_PARCIAL
    assert notas_por_num["901"].data_entrada is not None

    # 902 estava apenas no XML (não deu entrada no SPED):
    assert notas_por_num["902"].destino_planilha == ANTECIPACAO_PARCIAL_ANTECIPADO
    assert notas_por_num["902"].data_entrada is None


def _criar_planilha_auxiliar(registros: list) -> bytes:
    import io
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Chave de Acesso", "Número Nota", "Série", "Data Entrada"])
    for r in registros:
        ws.append(list(r))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_planilha_auxiliar_sem_sped_classifica_ausentes_como_antecipado(
    db_session, cenario_janeiro, xml_nf901, xml_nf902
):
    """Quando não há SPED mas a Planilha Auxiliar é enviada:
    - NF que consta na planilha tem data de entrada e fica na apuração normal.
    - NF ausente na planilha vai para 'Parcial Pago Antecipadamente' com data vazia."""
    import datetime
    from tests.conftest import CHAVE_NF901
    from app.constants import ANTECIPACAO_PARCIAL, ANTECIPACAO_PARCIAL_ANTECIPADO
    from app.services.pipeline_service import ProcessingPipelineService

    sol = cenario_janeiro(tipos=("antecipacao_parcial", "antecipacao_parcial_antecipado"))

    # Planilha contábil só contém a NF 901
    planilha_bytes = _criar_planilha_auxiliar([
        (CHAVE_NF901, "901", "1", "18/01/2026"),
    ])

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)],
        planilha_entradas_bytes=planilha_bytes,
        planilha_entradas_filename="entradas.xlsx",
    )
    db_session.refresh(res)

    notas_por_num = {n.numero_nota: n for n in res.notas_processadas}

    # 901 consta na planilha auxiliar:
    assert notas_por_num["901"].destino_planilha == ANTECIPACAO_PARCIAL
    assert notas_por_num["901"].data_entrada == datetime.date(2026, 1, 18)
    assert notas_por_num["901"].origem_data_entrada == "planilha_sistema_contabil"

    # 902 não consta na planilha auxiliar (mercadoria ainda não entrou):
    assert notas_por_num["902"].destino_planilha == ANTECIPACAO_PARCIAL_ANTECIPADO
    assert notas_por_num["902"].data_entrada is None


def test_sped_e_planilha_auxiliar_juntos_respeitam_uniao(
    db_session, cenario_janeiro, xml_nf901, xml_nf902, sped_janeiro_com_nf901
):
    """Quando ambos (SPED e Planilha Auxiliar) são fornecidos:
    - NF 901 (no SPED) -> apuração normal.
    - NF 902 (na Planilha Auxiliar) -> apuração normal.
    - NF 903 (em nenhum) -> Parcial Pago Antecipadamente."""
    import datetime
    from tests.conftest import build_xml_nfe, CHAVE_NF902, CHAVE_NF903
    from app.constants import ANTECIPACAO_PARCIAL, ANTECIPACAO_PARCIAL_ANTECIPADO
    from app.services.pipeline_service import ProcessingPipelineService

    sol = cenario_janeiro(tipos=("antecipacao_parcial", "antecipacao_parcial_antecipado"))

    xml_nf903 = build_xml_nfe("903", CHAVE_NF903, "1500.00", "25", cfop="6102")

    # Planilha auxiliar contém apenas a NF 902 (que não estava no SPED)
    planilha_bytes = _criar_planilha_auxiliar([
        (CHAVE_NF902, "902", "1", "22/01/2026"),
    ])

    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902), ("903.xml", xml_nf903)],
        sped_file_bytes=sped_janeiro_com_nf901,
        planilha_entradas_bytes=planilha_bytes,
        planilha_entradas_filename="entradas.xlsx",
    )
    db_session.refresh(res)

    notas_por_num = {n.numero_nota: n for n in res.notas_processadas}

    # 901 estava no SPED:
    assert notas_por_num["901"].destino_planilha == ANTECIPACAO_PARCIAL
    assert notas_por_num["901"].data_entrada is not None

    # 902 não estava no SPED, mas constava na planilha auxiliar:
    assert notas_por_num["902"].destino_planilha == ANTECIPACAO_PARCIAL
    assert notas_por_num["902"].data_entrada == datetime.date(2026, 1, 22)

    # 903 não constava em nenhuma fonte:
    assert notas_por_num["903"].destino_planilha == ANTECIPACAO_PARCIAL_ANTECIPADO
    assert notas_por_num["903"].data_entrada is None


def test_edicao_manual_data_entrada_em_antecipado_preserva_destino_e_exibe_data(
    client, db_session, cenario_janeiro, xml_nf901, xml_nf902, sped_janeiro_com_nf901
):
    """Atualização manual de data de entrada de nota em 'Pago Antecipadamente'
    mantém a nota na mesma planilha e reflete a data inserida."""
    import datetime
    from app.constants import ANTECIPACAO_PARCIAL_ANTECIPADO
    from app.services.pipeline_service import ProcessingPipelineService
    from app.services.pipeline_outputs import processed_note_to_row

    sol = cenario_janeiro(tipos=("antecipacao_parcial", "antecipacao_parcial_antecipado"))
    res = ProcessingPipelineService(db_session).process_solicitacao(
        sol.id,
        xml_files_bytes=[("901.xml", xml_nf901), ("902.xml", xml_nf902)],
        sped_file_bytes=sped_janeiro_com_nf901,
    )
    db_session.refresh(res)

    nota_902 = next(n for n in res.notas_processadas if n.numero_nota == "902")
    assert nota_902.destino_planilha == ANTECIPACAO_PARCIAL_ANTECIPADO
    assert nota_902.data_entrada is None

    # Atualiza manualmente a data de entrada via API
    res_patch = client.patch(
        f"/api/v1/solicitacoes/{sol.id}/notas/{nota_902.id}/data-entrada",
        json={"data_entrada": "2026-01-28"}
    )
    assert res_patch.status_code == 200
    nota_atualizada = res_patch.json()
    assert nota_atualizada["data_entrada"] == "2026-01-28"
    assert nota_atualizada["origem_data_entrada"] == "manual"
    assert nota_atualizada["destino_planilha"] == ANTECIPACAO_PARCIAL_ANTECIPADO

    # Verifica que o contrato de linha para preenchimento de template reflete a data
    db_session.refresh(nota_902)
    row = processed_note_to_row(nota_902)
    assert row["data_entrada"] == datetime.date(2026, 1, 28)


