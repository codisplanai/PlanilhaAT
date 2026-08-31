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
