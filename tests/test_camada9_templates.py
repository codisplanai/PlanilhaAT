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
