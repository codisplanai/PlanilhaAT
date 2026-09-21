import pytest
from app.services.templates_admin.template_manager import TemplateManager
from app.core.exceptions import ValidationException

def test_template_upload_e_versionamento(db_session, create_sample_excel_template):
    template_path = create_sample_excel_template("antecipacao_parcial")
    with open(template_path, "rb") as f:
        file_bytes = f.read()

    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {
            "numero_nota": "A",
            "v_total": "D",
            "a_dst": "G"
        }
    }

    # Upload versão 1
    t1 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=file_bytes,
        filename="modelo_v1.xlsx",
        mapeamento=mapping,
        observacoes="Primeira versão oficial"
    )
    assert t1.versao == 1
    assert t1.ativo is True # Primeiro template fica ativo por padrão

    # Upload versão 2 (sem promover imediatamente)
    t2 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=file_bytes,
        filename="modelo_v2.xlsx",
        mapeamento=mapping,
        observacoes="Segunda versão para testes",
        promover_ativo=False
    )
    assert t2.versao == 2
    assert t2.ativo is False

    # A versão 1 ainda é a ativa
    ativo = TemplateManager.get_active_template(db_session, "antecipacao_parcial")
    assert ativo.id == t1.id

    # Promover versão 2
    TemplateManager.promote_version(db_session, t2.id)

    ativo_apos_promocao = TemplateManager.get_active_template(db_session, "antecipacao_parcial")
    assert ativo_apos_promocao.id == t2.id
    assert ativo_apos_promocao.versao == 2

    # Versão 1 foi desativada automaticamente
    db_session.refresh(t1)
    assert t1.ativo is False

def test_template_mapeamento_obrigatorio_invalido(db_session, create_sample_excel_template):
    template_path = create_sample_excel_template("antecipacao_parcial")
    with open(template_path, "rb") as f:
        file_bytes = f.read()

    # Mapeamento inválido sem start_row
    invalid_mapping = {"columns": {"v_total": "A"}}

    with pytest.raises(ValidationException):
        TemplateManager.upload_new_template_version(
            db=db_session,
            tipo="antecipacao_parcial",
            file_bytes=file_bytes,
            filename="invalido.xlsx",
            mapeamento=invalid_mapping
        )

def test_templates_por_capacidade_selecionam_o_menor_modelo_suficiente(
    db_session,
    create_sample_excel_template,
):
    template_path = create_sample_excel_template("antecipacao_parcial")
    with open(template_path, "rb") as handle:
        file_bytes = handle.read()

    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {"numero_nota": "A", "v_total": "D"},
    }

    t100_v1 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=file_bytes,
        filename="parcial_100.xlsx",
        mapeamento=mapping,
        capacidade_linhas=100,
        promover_ativo=True,
    )
    t300 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=file_bytes,
        filename="parcial_300.xlsx",
        mapeamento=mapping,
        capacidade_linhas=300,
        promover_ativo=True,
    )

    assert t100_v1.ativo is True
    assert t300.ativo is True
    assert TemplateManager.get_active_template(
        db_session, "antecipacao_parcial", required_rows=1
    ).id == t100_v1.id
    assert TemplateManager.get_active_template(
        db_session, "antecipacao_parcial", required_rows=100
    ).id == t100_v1.id
    assert TemplateManager.get_active_template(
        db_session, "antecipacao_parcial", required_rows=101
    ).id == t300.id
    assert TemplateManager.get_active_template(
        db_session, "antecipacao_parcial", required_rows=300
    ).id == t300.id

    with pytest.raises(ValidationException, match="necessita de 301 linhas"):
        TemplateManager.get_active_template(
            db_session, "antecipacao_parcial", required_rows=301
        )

    t100_v2 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="antecipacao_parcial",
        file_bytes=file_bytes,
        filename="parcial_100_v2.xlsx",
        mapeamento=mapping,
        capacidade_linhas=100,
        promover_ativo=False,
    )
    assert t100_v2.ativo is False

    TemplateManager.promote_version(db_session, t100_v2.id)
    db_session.refresh(t100_v1)
    db_session.refresh(t300)
    db_session.refresh(t100_v2)

    assert t100_v1.ativo is False
    assert t100_v2.ativo is True
    assert t300.ativo is True
    assert TemplateManager.get_active_template(
        db_session, "antecipacao_parcial", required_rows=80
    ).id == t100_v2.id


def test_template_legado_continua_funcionando_sem_capacidades(
    db_session,
    create_sample_excel_template,
):
    template_path = create_sample_excel_template("difal")
    with open(template_path, "rb") as handle:
        file_bytes = handle.read()

    legacy = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="difal",
        file_bytes=file_bytes,
        filename="difal_legado.xlsx",
        mapeamento={"start_row": 4, "columns": {"numero_nota": "A"}},
        promover_ativo=True,
    )

    assert legacy.capacidade_linhas is None
    assert TemplateManager.get_active_template(
        db_session, "difal", required_rows=5000
    ).id == legacy.id

def test_margem_de_seguranca_e_opcional_e_altera_a_capacidade_necessaria(
    db_session,
    create_sample_excel_template,
):
    template_path = create_sample_excel_template("difal")
    with open(template_path, "rb") as handle:
        file_bytes = handle.read()

    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {"numero_nota": "A", "v_total": "D"},
    }

    t100 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="difal",
        file_bytes=file_bytes,
        filename="difal_100.xlsx",
        mapeamento=mapping,
        capacidade_linhas=100,
        promover_ativo=True,
    )
    t300 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="difal",
        file_bytes=file_bytes,
        filename="difal_300.xlsx",
        mapeamento=mapping,
        capacidade_linhas=300,
        promover_ativo=True,
    )

    assert TemplateManager.get_safety_margin(db_session, "difal") == 0
    assert TemplateManager.get_active_template(
        db_session, "difal", required_rows=96
    ).id == t100.id

    TemplateManager.set_safety_margin(db_session, "difal", 5)
    assert TemplateManager.get_safety_margin(db_session, "difal") == 5
    assert TemplateManager.get_active_template(
        db_session, "difal", required_rows=95
    ).id == t100.id
    assert TemplateManager.get_active_template(
        db_session, "difal", required_rows=96
    ).id == t300.id

    with pytest.raises(
        ValidationException,
        match=r"296 linhas \+ 5 linhas de segurança = 301.*suporta 300 linhas",
    ):
        TemplateManager.get_active_template(
            db_session, "difal", required_rows=296
        )

    t100_v2 = TemplateManager.upload_new_template_version(
        db=db_session,
        tipo="difal",
        file_bytes=file_bytes,
        filename="difal_100_v2.xlsx",
        mapeamento=mapping,
        capacidade_linhas=100,
        promover_ativo=False,
    )
    assert (
        t100_v2.mapeamento_campos["extra_options"]["margem_seguranca_linhas"]
        == 5
    )

    TemplateManager.set_safety_margin(db_session, "difal", 0)
    assert TemplateManager.get_safety_margin(db_session, "difal") == 0
    assert TemplateManager.get_active_template(
        db_session, "difal", required_rows=96
    ).id == t100.id

