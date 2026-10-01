from app.services.pipeline_helpers import (
    build_spreadsheet_filename,
    format_competencia_nome,
    resolve_modelo_planilha,
    resolve_tipo_curto,
    sanitize_company_name,
)


def test_sanitize_company_name_pascal_case_and_suffix_removal():
    assert sanitize_company_name("PASSO A PASSO CALCADOS LTDA") == "PassoAPasso"
    assert sanitize_company_name("SUPERMERCADO SÃO JOÃO & CIA LTDA") == "SupermercadoSao"
    assert sanitize_company_name("AUTO PECAS BRASIL S/A") == "AutoPecasBrasil"
    assert sanitize_company_name("BANCO DO NORDESTE S.A.") == "BancoNordeste"


def test_sanitize_company_name_length_limit():
    result = sanitize_company_name("EMPRESA COM NOME GIGANTESCO EXTRAORDINARIO")
    assert len(result) <= 18
    assert result == "EmpresaNome"


def test_sanitize_company_name_fallback():
    assert sanitize_company_name("") == "Empresa"
    assert sanitize_company_name("   ") == "Empresa"
    assert sanitize_company_name("---***---") == "Empresa"


def test_resolve_modelo_planilha():
    assert (
        resolve_modelo_planilha(
            "antecipacao_parcial",
            "Modelo oficial pré-definido de Antecipação Parcial (RP-153)",
        )
        == "RP-153"
    )
    assert (
        resolve_modelo_planilha("difal", "Modelo oficial pré-definido de DIFAL (RP-158)")
        == "RP-158"
    )
    assert resolve_modelo_planilha("antecipacao_parcial") == "RP-153"
    assert resolve_modelo_planilha("antecipacao_parcial_antecipado") == "RP-155"
    assert resolve_modelo_planilha("antecipacao_parcial_simples") == "RP-154"
    assert resolve_modelo_planilha("antecipacao_parcial_antecipado_simples") == "RP-156"
    assert resolve_modelo_planilha("antecipacao_tributaria") == "RP-151"
    assert resolve_modelo_planilha("antecipacao_tributaria_antecipado") == "RP-151"
    assert resolve_modelo_planilha("difal") == "RP-158"


def test_resolve_tipo_curto():
    assert resolve_tipo_curto("antecipacao_parcial") == "Parcial"
    assert resolve_tipo_curto("antecipacao_parcial_antecipado") == "Parcial-Antecipado"
    assert resolve_tipo_curto("antecipacao_parcial_simples") == "Parcial-Simples"
    assert resolve_tipo_curto("antecipacao_parcial_antecipado_simples") == "Parcial-Ant-Simples"
    assert resolve_tipo_curto("antecipacao_tributaria") == "AT"
    assert resolve_tipo_curto("antecipacao_tributaria_antecipado") == "AT-Antecipado"
    assert resolve_tipo_curto("difal") == "DIFAL"


def test_format_competencia_nome():
    assert format_competencia_nome(9, 2026) == "09-2026"
    assert format_competencia_nome("08", "2026") == "08-2026"
    assert format_competencia_nome(12, 2025) == "12-2025"


def test_build_spreadsheet_filename():
    filename = build_spreadsheet_filename(
        razao_social="PASSO A PASSO CALCADOS LTDA",
        tipo="antecipacao_parcial",
        month=9,
        year=2026,
        observacoes="Modelo oficial pré-definido de Antecipação Parcial (RP-153)",
    )
    assert filename == "PassoAPasso_RP-153_Parcial_09-2026.xlsx"

    filename_difal = build_spreadsheet_filename(
        razao_social="AUTO PECAS BRASIL S/A",
        tipo="difal",
        month=8,
        year=2026,
    )
    assert filename_difal == "AutoPecasBrasil_RP-158_DIFAL_08-2026.xlsx"

    filename_at = build_spreadsheet_filename(
        razao_social="COMERCIAL SILVA ME",
        tipo="antecipacao_tributaria_antecipado",
        month=10,
        year=2026,
    )
    assert filename_at == "ComercialSilva_RP-151_AT-Antecipado_10-2026.xlsx"
