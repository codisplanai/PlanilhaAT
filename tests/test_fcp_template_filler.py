import os
from datetime import date, datetime
from decimal import Decimal

import openpyxl
from app.constants import (
    ANTECIPACAO_TRIBUTARIA,
    ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
)
from app.core.config import settings
from app.core.seeds import (
    DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_MAPPING,
    DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_TEMPLATE_PATH,
    DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING,
    DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH,
    seed_default_templates,
)
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.perfil_regras import PerfilRegras
from app.models.solicitacao import Solicitacao
from app.models.template_xlsx import TemplateXlsx
from app.services.excel.formula_guard import FormulaGuard
from app.services.excel.template_filler import TemplateFiller
from app.services.pipeline_outputs import PipelineOutputService


def _header_maio() -> dict:
    return {
        "razao_social": "BEBIDAS BAHIA LTDA",
        "cnpj": "12345678000195",
        "ie": "83592715",
        "competencia": "05/2026",
        "mes": 5,
        "ano": 2026,
    }


def _sample_at_row() -> dict:
    return {
        "numero_nota": "1001",
        "data_entrada": date(2026, 5, 10),
        "data_emissao": date(2026, 5, 5),
        "v_total": Decimal("1000.00"),
        "base_calculo": Decimal("1000.00"),
        "ipi_despesas": Decimal("0.00"),
        "mva": Decimal("64.39"),
        "reducao": None,
        "red": "",
        "a_dst": Decimal("0.2500"),
        "a_ori": Decimal("0.0700"),
        "debito": Decimal("410.98"),
        "credito": Decimal("70.00"),
        "valor_devido": Decimal("340.98"),
    }


def _sample_fcp_row() -> dict:
    return {
        "numero_nota": "1001",
        "data_entrada": date(2026, 5, 10),
        "data_emissao": date(2026, 5, 5),
        "v_total": Decimal("1000.00"),
        "base_calculo": Decimal("1000.00"),
        "ipi_despesas": Decimal("0.00"),
        "mva": Decimal("64.39"),
        "reducao": None,
        "red": "",
        "a_dst": Decimal("0.0200"),
        "a_ori": Decimal("0.00"),
        "debito": Decimal("32.88"),
        "credito": Decimal("0.00"),
        "valor_devido": Decimal("32.88"),
        "valor_pago": Decimal("0.00"),
    }


def test_fill_template_gera_duas_abas_com_formulas_e_logo_intactos(tmp_path):
    assert os.path.exists(DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH)
    output_path = str(tmp_path / "saida_duas_abas.xlsx")

    orig_wb = openpyxl.load_workbook(DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH, data_only=False)
    orig_formulas = FormulaGuard.extract_formula_map(orig_wb)[orig_wb.active.title]
    orig_wb.close()

    TemplateFiller.fill_template(
        template_path=DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH,
        mapping=DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING,
        rows_data=[_sample_at_row()],
        output_path=output_path,
        header_info=_header_maio(),
        fcp_rows=[_sample_fcp_row()],
    )

    wb = openpyxl.load_workbook(output_path, data_only=False)
    assert wb.sheetnames == ["05-2026", "05-2026 FCP"]

    ws_main = wb["05-2026"]
    ws_fcp = wb["05-2026 FCP"]

    assert "BEBIDAS BAHIA LTDA" in ws_main["A2"].value
    assert "05/2026" in ws_main["A2"].value
    assert "BEBIDAS BAHIA LTDA" in ws_fcp["A2"].value
    assert "05/2026" in ws_fcp["A2"].value

    assert ws_main["J4"].value == 25.0
    assert ws_main["K4"].value == 7.0

    assert ws_fcp["D4"].value == "1001"
    assert ws_fcp["E4"].value == 1000.0
    assert ws_fcp["H4"].value == 64.39
    assert ws_fcp["J4"].value == 2
    assert ws_fcp["K4"].value == 0
    assert ws_fcp["S4"].value == 0

    assert len(getattr(ws_main, "_images", [])) >= 1
    assert len(getattr(ws_fcp, "_images", [])) >= 1

    FormulaGuard.verify_wb_integrity(
        {"05-2026": orig_formulas, "05-2026 FCP": orig_formulas},
        wb,
    )
    wb.close()


def test_fill_template_antecipado_tambem_gera_duas_abas_mm_aaaa(tmp_path):
    assert os.path.exists(DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_TEMPLATE_PATH)
    output_path = str(tmp_path / "saida_antecipado_duas_abas.xlsx")

    row_main = {**_sample_at_row(), "data_entrada": None}
    row_fcp = {**_sample_fcp_row(), "data_entrada": None}

    TemplateFiller.fill_template(
        template_path=DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_TEMPLATE_PATH,
        mapping=DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_MAPPING,
        rows_data=[row_main],
        output_path=output_path,
        header_info=_header_maio(),
        fcp_rows=[row_fcp],
    )

    wb = openpyxl.load_workbook(output_path, data_only=False)
    assert wb.sheetnames == ["05-2026", "05-2026 FCP"]
    assert wb["05-2026"]["B4"].value is None
    assert wb["05-2026 FCP"]["B4"].value is None
    assert wb["05-2026 FCP"]["J4"].value == 2
    assert wb["05-2026 FCP"]["K4"].value == 0
    assert wb["05-2026 FCP"]["S4"].value == 0
    assert len(getattr(wb["05-2026"], "_images", [])) >= 1
    assert len(getattr(wb["05-2026 FCP"], "_images", [])) >= 1
    wb.close()


def test_aba_fcp_limpa_linhas_exemplo_residuais_do_template(tmp_path):
    output_path = str(tmp_path / "saida_limpa_residuos.xlsx")

    TemplateFiller.fill_template(
        template_path=DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH,
        mapping=DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING,
        rows_data=[_sample_at_row()],
        output_path=output_path,
        header_info=_header_maio(),
        fcp_rows=[_sample_fcp_row()],
    )

    wb = openpyxl.load_workbook(output_path, data_only=False)
    for sheet_name in ("05-2026", "05-2026 FCP"):
        ws = wb[sheet_name]
        for cell_ref in ("D5", "E5", "H5", "J5", "H6", "J6", "S5"):
            assert ws[cell_ref].value is None, f"{sheet_name}!{cell_ref} deveria estar limpa"

        # item_index pré-numerado no modelo permanece intacto
        assert ws["A5"].value == 2
        assert ws["A6"].value == 3

        # Fórmulas da grade e linha de totais permanecem intactas
        assert isinstance(ws["N5"].value, str) and ws["N5"].value.startswith("=")
        assert ws["O5"].value == "=N5*J5%"
        assert ws["Q5"].value == "=O5-P5"
        for col in ("E", "F", "G", "N", "O", "P", "Q", "S", "T"):
            val = ws[f"{col}39"].value
            assert isinstance(val, str) and val.startswith("=SUM("), (
                f"{sheet_name}!{col}39 deveria manter fórmula =SUM(...)"
            )
    wb.close()


def test_fill_template_sem_fcp_rows_mantem_aba_unica(tmp_path):
    out_none = str(tmp_path / "saida_sem_fcp_none.xlsx")
    out_empty = str(tmp_path / "saida_sem_fcp_empty.xlsx")

    TemplateFiller.fill_template(
        template_path=DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH,
        mapping=DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING,
        rows_data=[_sample_at_row()],
        output_path=out_none,
        header_info=_header_maio(),
        fcp_rows=None,
    )
    TemplateFiller.fill_template(
        template_path=DEFAULT_ANTECIPACAO_TRIBUTARIA_TEMPLATE_PATH,
        mapping=DEFAULT_ANTECIPACAO_TRIBUTARIA_MAPPING,
        rows_data=[_sample_at_row()],
        output_path=out_empty,
        header_info=_header_maio(),
        fcp_rows=[],
    )

    for path in (out_none, out_empty):
        wb = openpyxl.load_workbook(path, data_only=False)
        assert wb.sheetnames == ["05-2026"]
        wb.close()


def test_processed_note_to_fcp_rows_suporta_nota_e_parcelas_cte(db_session, tmp_path, monkeypatch):
    from app.services.pipeline_outputs import processed_note_to_fcp_rows

    monkeypatch.setattr(settings, "OUTPUTS_DIR", str(tmp_path))

    nota_sem_fcp = NotaFiscalProcessada(
        numero_nota="10",
        serie="1",
        cnpj_destinatario="12345678000195",
        data_emissao=datetime(2026, 5, 2),
        data_entrada=date(2026, 5, 6),
        item_numero=1,
        ncm="22011000",
        cfop="6403",
        destino_planilha=ANTECIPACAO_TRIBUTARIA,
        v_total=Decimal("100.00"),
        base_calculo=Decimal("100.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.0700"),
        a_dst_resolvida=Decimal("0.2050"),
        debito=Decimal("20.50"),
        credito=Decimal("7.00"),
        valor_devido=Decimal("13.50"),
        metadados_extras={"fcp_separado": False},
    )
    assert processed_note_to_fcp_rows(nota_sem_fcp) == []

    nota_fcp = NotaFiscalProcessada(
        numero_nota="20",
        serie="1",
        cnpj_destinatario="12345678000195",
        data_emissao=datetime(2026, 5, 3),
        data_entrada=date(2026, 5, 7),
        origem_data_entrada="sped_fiscal",
        item_numero=1,
        ncm="22030000",
        cfop="6403",
        destino_planilha=ANTECIPACAO_TRIBUTARIA,
        v_total=Decimal("1000.00"),
        base_calculo=Decimal("1000.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.0700"),
        a_dst_resolvida=Decimal("0.2500"),
        debito=Decimal("410.98"),
        credito=Decimal("70.00"),
        valor_devido=Decimal("340.98"),
        metadados_extras={
            "mva": "64.39",
            "reducao": None,
            "a_dst_base": "0.2500",
            "fcp_aliquota": "0.0200",
            "fcp_separado": True,
            "fcp_base_st": "1643.90",
            "fcp_valor_devido": "32.88",
        },
    )
    fcp_rows_nota = processed_note_to_fcp_rows(nota_fcp)
    assert len(fcp_rows_nota) == 1
    assert fcp_rows_nota[0]["a_dst"] == Decimal("0.0200")
    assert fcp_rows_nota[0]["a_ori"] == Decimal("0.00")
    assert fcp_rows_nota[0]["credito"] == Decimal("0.00")
    assert fcp_rows_nota[0]["valor_pago"] == Decimal("0.00")
    assert fcp_rows_nota[0]["valor_devido"] == Decimal("32.88")
    assert fcp_rows_nota[0]["debito"] == Decimal("32.88")
    assert fcp_rows_nota[0]["mva"] == Decimal("64.39")
    assert fcp_rows_nota[0]["data_entrada"] == date(2026, 5, 7)

    # CT-e com 1 faixa FCP parcial e reducao distinta da principal
    cte_faixa_unica = NotaFiscalProcessada(
        numero_nota="300",
        serie="1",
        cnpj_destinatario="12345678000195",
        data_emissao=datetime(2026, 5, 4),
        data_entrada=date(2026, 5, 8),
        origem_data_entrada="sped_fiscal",
        item_numero=1,
        ncm="",
        cfop="6352",
        destino_planilha=ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
        v_total=Decimal("500.00"),
        base_calculo=Decimal("500.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.0700"),
        a_dst_resolvida=Decimal("0.2500"),
        debito=Decimal("200.00"),
        credito=Decimal("35.00"),
        valor_devido=Decimal("165.00"),
        metadados_extras={
            "tipo_documento": "cte",
            "mva": "50.00",
            "reducao": "20.00",
            "fcp_separado": True,
            "fcp_aliquota": "0.0200",
            "fcp_cte_v_total": "250.00",
            "fcp_cte_mva": "64.39",
            "fcp_cte_reducao": None,
            "fcp_base_st": "410.98",
            "fcp_valor_devido": "8.22",
        },
    )
    fcp_cte_1 = processed_note_to_fcp_rows(cte_faixa_unica)
    assert len(fcp_cte_1) == 1
    assert fcp_cte_1[0]["v_total"] == Decimal("250.00")
    assert fcp_cte_1[0]["base_calculo"] == Decimal("250.00")
    assert fcp_cte_1[0]["mva"] == Decimal("64.39")
    assert fcp_cte_1[0]["reducao"] is None
    assert fcp_cte_1[0]["data_entrada"] is None  # antecipado não-manual
    assert fcp_cte_1[0]["valor_pago"] == Decimal("0.00")

    # CT-e com múltiplas parcelas FCP
    cte_parcelas = NotaFiscalProcessada(
        numero_nota="400",
        serie="1",
        cnpj_destinatario="12345678000195",
        data_emissao=datetime(2026, 5, 5),
        data_entrada=date(2026, 5, 9),
        origem_data_entrada="sped_fiscal",
        item_numero=1,
        ncm="",
        cfop="6352",
        destino_planilha=ANTECIPACAO_TRIBUTARIA,
        v_total=Decimal("1000.00"),
        base_calculo=Decimal("1000.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.0700"),
        a_dst_resolvida=Decimal("0.2500"),
        debito=Decimal("400.00"),
        credito=Decimal("70.00"),
        valor_devido=Decimal("330.00"),
        metadados_extras={
            "tipo_documento": "cte",
            "fcp_separado": True,
            "fcp_parcelas": [
                {
                    "v_total": "600.00",
                    "base_calculo": "600.00",
                    "mva": "64.39",
                    "reducao": None,
                    "fcp_aliquota": "0.0200",
                    "fcp_base_st": "986.34",
                    "debito": "19.73",
                    "fcp_valor_devido": "19.73",
                    "percentual_rateio": "0.60",
                    "fcp_origem": "fcp_produto:1",
                    "fcp_detalhe": "Cerveja 2%",
                },
                {
                    "v_total": "400.00",
                    "base_calculo": "400.00",
                    "mva": "40.00",
                    "reducao": "10.00",
                    "fcp_aliquota": "0.0100",
                    "fcp_base_st": "504.00",
                    "debito": "5.04",
                    "fcp_valor_devido": "5.04",
                    "percentual_rateio": "0.40",
                    "fcp_origem": "fcp_produto:2",
                    "fcp_detalhe": "Outro 1%",
                },
            ],
        },
    )
    fcp_cte_multi = processed_note_to_fcp_rows(cte_parcelas)
    assert len(fcp_cte_multi) == 2
    assert fcp_cte_multi[0]["a_dst"] == Decimal("0.0200")
    assert fcp_cte_multi[0]["valor_devido"] == Decimal("19.73")
    assert fcp_cte_multi[0]["valor_pago"] == Decimal("0.00")
    assert fcp_cte_multi[1]["a_dst"] == Decimal("0.0100")
    assert fcp_cte_multi[1]["reducao"] == Decimal("10.00")
    assert fcp_cte_multi[1]["valor_devido"] == Decimal("5.04")
    assert fcp_cte_multi[1]["a_ori"] == Decimal("0.00")
    assert fcp_cte_multi[1]["credito"] == Decimal("0.00")
    assert fcp_cte_multi[1]["valor_pago"] == Decimal("0.00")

    # End-to-end com PipelineOutputService.generate + regenerate com data_entrada atualizada
    seed_default_templates(db_session)
    perfil = PerfilRegras(nome="Perfil FCP Output")
    db_session.add(perfil)
    db_session.commit()
    empresa = Empresa(
        razao_social="BEBIDAS BAHIA LTDA",
        cnpj="12345678000195",
        inscricao_estadual="83592715",
        uf="BA",
        perfil_regras_id=perfil.id,
    )
    db_session.add(empresa)
    db_session.commit()

    solicitacao = Solicitacao(
        empresa_id=empresa.id,
        periodo_inicio=date(2026, 5, 1),
        periodo_fim=date(2026, 5, 31),
        tipo_planilha=None,
        status="concluido",
    )
    db_session.add(solicitacao)
    db_session.commit()

    nota_antecipado = NotaFiscalProcessada(
        solicitacao_id=solicitacao.id,
        numero_nota="501",
        serie="1",
        cnpj_destinatario=empresa.cnpj,
        uf_destinatario="BA",
        data_emissao=datetime(2026, 5, 4),
        data_entrada=None,
        origem_data_entrada=None,
        item_numero=1,
        ncm="22030000",
        cfop="6403",
        destino_planilha=ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
        v_total=Decimal("1000.00"),
        base_calculo=Decimal("1000.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.0700"),
        a_dst_resolvida=Decimal("0.2500"),
        debito=Decimal("410.98"),
        credito=Decimal("70.00"),
        valor_devido=Decimal("340.98"),
        metadados_extras={
            "mva": "64.39",
            "reducao": None,
            "a_dst_base": "0.2500",
            "fcp_aliquota": "0.0200",
            "fcp_separado": True,
            "fcp_base_st": "1643.90",
            "fcp_valor_devido": "32.88",
        },
    )
    db_session.add(nota_antecipado)
    db_session.commit()

    # Garante seleção de capacidade pelo maior entre rows e fcp_rows (ex: 1 vs 2 parcelas)
    cap1_template = TemplateXlsx(
        tipo=ANTECIPACAO_TRIBUTARIA_ANTECIPADO,
        versao=99,
        capacidade_linhas=1,
        arquivo_path=DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_TEMPLATE_PATH,
        arquivo_hash="",
        mapeamento_campos=DEFAULT_ANTECIPACAO_TRIBUTARIA_ANTECIPADO_MAPPING,
        ativo=True,
    )
    db_session.add(cap1_template)
    db_session.commit()

    output_service = PipelineOutputService(db_session)
    artifacts = output_service.generate(
        solicitacao=solicitacao,
        empresa=empresa,
        rows_by_destination={ANTECIPACAO_TRIBUTARIA_ANTECIPADO: [_sample_at_row()]},
        legacy_mode=False,
        legacy_template=None,
        header_info=_header_maio(),
        fcp_rows_by_destination={
            ANTECIPACAO_TRIBUTARIA_ANTECIPADO: [_sample_fcp_row(), _sample_fcp_row()]
        },
    )
    db_session.commit()
    db_session.refresh(solicitacao)

    assert len(artifacts.local_paths) == 1
    saida = solicitacao.saidas[0]
    assert saida.template_id != cap1_template.id  # cap=1 não comporta fcp_rows=2 -> escolheu cap=35
    assert saida.total_valor_devido == Decimal("340.98")

    wb_gen = openpyxl.load_workbook(saida.arquivo_path, data_only=False)
    assert wb_gen.sheetnames == ["05-2026", "05-2026 FCP"]
    wb_gen.close()

    # Atualiza data_entrada manualmente e regenera
    nota_antecipado.data_entrada = date(2026, 5, 25)
    nota_antecipado.origem_data_entrada = "manual"
    db_session.commit()

    output_service.regenerate(solicitacao)
    db_session.refresh(saida)

    wb_reg = openpyxl.load_workbook(saida.arquivo_path, data_only=False)
    assert wb_reg.sheetnames == ["05-2026", "05-2026 FCP"]
    assert wb_reg["05-2026"]["B4"].value == datetime(2026, 5, 25, 0, 0)
    assert wb_reg["05-2026 FCP"]["B4"].value == datetime(2026, 5, 25, 0, 0)
    assert wb_reg["05-2026 FCP"]["J4"].value == 2
    assert wb_reg["05-2026 FCP"]["K4"].value == 0
    assert wb_reg["05-2026 FCP"]["S4"].value == 0
    wb_reg.close()
