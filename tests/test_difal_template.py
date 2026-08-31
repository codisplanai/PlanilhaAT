import os
import openpyxl
from decimal import Decimal
from datetime import date
import pytest

from app.core.config import settings
from app.core.seeds import DEFAULT_DIFAL_MAPPING
from app.services.excel.template_filler import TemplateFiller
from app.services.excel.formula_guard import FormulaGuard
from app.services.calculation.difal import DifalCalculator

TEMPLATE_PATH = os.path.join(settings.TEMPLATES_DIR, "modelo_padrao_difal.xlsx")

def test_official_difal_template_exists_and_has_all_months():
    assert os.path.exists(TEMPLATE_PATH), f"Arquivo do template {TEMPLATE_PATH} não encontrado"
    wb = openpyxl.load_workbook(TEMPLATE_PATH, data_only=False)
    expected_sheets = [
        "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
        "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"
    ]
    assert wb.sheetnames == expected_sheets

    for sname in expected_sheets:
        ws = wb[sname]
        assert ws["E1"].value == "CÁLCULO DIFERENCIAL DE ALÍQUOTA"
        assert "RP-158" in str(ws["N1"].value)
        assert ws["B3"].value == "DATA ENTRADA"
        assert ws["E3"].value == "   V. CONTÁBIL"
        assert ws["G3"].value == "ALIQ. SIMPLES"
        assert ws["H3"].value == "B.CÁLCULO"
        assert ws["I3"].value == "  A. DST"
        assert ws["J3"].value == "  A.ORI"
        assert ws["K3"].value == "DÉBITO"
        assert ws["L3"].value == "CRÉDITO"
        assert ws["M3"].value == "VR.DEVIDO"
        assert ws["O3"].value == "DIFER."
        assert ws["D39"].value == "TOTAL"

def test_difal_template_formulas_intact_and_formula_guard():
    wb = openpyxl.load_workbook(TEMPLATE_PATH, data_only=False)
    formula_map = FormulaGuard.extract_formula_map(wb)
    assert len(formula_map) == 12

    for sname, sheet_formulas in formula_map.items():
        assert len(sheet_formulas) >= 180, f"Aba {sname} deveria ter pelo menos 180 fórmulas mapeadas"
        # Verificar fórmulas de linhas de dados
        assert "IF(G4=" in sheet_formulas[(4, 8)]                  # B.CÁLCULO (Col H)
        assert sheet_formulas[(4, 11)] == "=H4*I4%"                # DÉBITO (Col K)
        assert sheet_formulas[(4, 12)] == "=E4*J4%"                # CRÉDITO (Col L)
        assert "IF(G4=" in sheet_formulas[(4, 13)]                 # VR.DEVIDO (Col M)
        assert sheet_formulas[(4, 15)] == "=M4-N4"                 # DIFER (Col O)
        # Verificar totais
        assert sheet_formulas[(39, 5)] == "=SUM(E4:E38)"           # TOTAL V. CONTABIL
        assert sheet_formulas[(39, 8)] == "=SUM(H4:H38)"           # TOTAL B.CALCULO
        assert sheet_formulas[(39, 11)] == "=SUM(K4:K38)"         # TOTAL DEBITO
        assert sheet_formulas[(39, 12)] == "=SUM(L4:L38)"         # TOTAL CREDITO
        assert sheet_formulas[(39, 13)] == "=SUM(M4:M38)"         # TOTAL VR.DEVIDO

def test_difal_calculator_regime_normal_and_simples():
    calc = DifalCalculator()

    # 1. Regime Normal (aliq_simples = 'N'):
    # V.Total = 414.29, IPI = 0, A.ORI = 7% (0.07), A.DST = 20.5% (0.205)
    # Base ST = (414.29 - (414.29 * 0.07)) / (1 - 0.205) = (414.29 - 29.00) / 0.795 = 385.29 / 0.795 = 484.64
    # Débito = 484.64 * 0.205 = 99.35
    # Crédito = 414.29 * 0.07 = 29.00
    # Valor Devido = 99.35 - 29.00 = 70.35
    res_normal = calc.calculate(
        v_total=Decimal("414.29"),
        base_calculo=Decimal("414.29"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.07"),
        a_dst=Decimal("0.205"),
        parametros_extras={"aliq_simples": "N"}
    )
    assert res_normal.debito == Decimal("99.35")
    assert res_normal.credito == Decimal("29.00")
    assert res_normal.valor_devido == Decimal("70.35")

    # 2. Simples Nacional sem crédito (aliq_simples = 'S'):
    # V.Total = 1000.00, IPI = 0, A.ORI = 12% (0.12), A.DST = 20.5% (0.205)
    # Base ST = 1000.00 / 0.795 = 1257.86
    # Valor Devido = 1257.86 * (0.205 - 0.12) = 1257.86 * 0.085 = 106.92
    res_simples = calc.calculate(
        v_total=Decimal("1000.00"),
        base_calculo=Decimal("1000.00"),
        ipi_despesas=Decimal("0.00"),
        a_ori=Decimal("0.12"),
        a_dst=Decimal("0.205"),
        parametros_extras={"aliq_simples": "S"}
    )
    assert res_simples.valor_devido == Decimal("106.92")

def test_template_filler_populates_difal_cleanly(tmp_path):
    output_xlsx = str(tmp_path / "test_out_difal.xlsx")
    rows_data = [
        {
            "numero_nota": "4848579",
            "data_entrada": date(2026, 7, 1),
            "data_emissao": date(2026, 2, 26),
            "v_total": Decimal("414.29"),
            "base_calculo": Decimal("414.29"),
            "ipi_despesas": Decimal("0.00"),
            "aliq_simples": "N",
            "a_dst": Decimal("20.50"),
            "a_ori": Decimal("7.00"),
            "debito": Decimal("99.35"),
            "credito": Decimal("29.00"),
            "valor_devido": Decimal("70.35")
        },
        {
            "numero_nota": "215027",
            "data_entrada": date(2026, 7, 1),
            "data_emissao": date(2026, 4, 18),
            "v_total": Decimal("32754.00"),
            "base_calculo": Decimal("32754.00"),
            "ipi_despesas": Decimal("0.00"),
            "aliq_simples": "N",
            "a_dst": Decimal("20.50"),
            "a_ori": Decimal("12.00"),
            "debito": Decimal("7437.38"),
            "credito": Decimal("3930.48"),
            "valor_devido": Decimal("3506.90")
        }
    ]

    header_info = {
        "razao_social": "CAMATEX CONFECCOES LTDA",
        "cnpj": "12345678000195",
        "ie": "89413195",
        "competencia": "07/2026",
        "mes": 7
    }

    TemplateFiller.fill_template(
        template_path=TEMPLATE_PATH,
        mapping=DEFAULT_DIFAL_MAPPING,
        rows_data=rows_data,
        output_path=output_xlsx,
        header_info=header_info
    )

    assert os.path.exists(output_xlsx)
    out_wb = openpyxl.load_workbook(output_xlsx, data_only=False)
    ws_julho = out_wb["JULHO"]

    # Validar header
    assert "CAMATEX CONFECCOES" in ws_julho["A2"].value
    assert "07/2026" in ws_julho["A2"].value

    # Linha 4
    assert ws_julho["A4"].value == 1
    assert ws_julho["D4"].value == "4848579"
    assert ws_julho["E4"].value == 414.29
    assert ws_julho["G4"].value == "N"
    assert ws_julho["I4"].value == 20.50
    assert ws_julho["J4"].value == 7.00
    assert "IF(G4=" in ws_julho["H4"].value
    assert ws_julho["K4"].value == "=H4*I4%"
    assert ws_julho["L4"].value == "=E4*J4%"
    assert "IF(G4=" in ws_julho["M4"].value
    assert ws_julho["O4"].value == "=M4-N4"

    # Linha 5
    assert ws_julho["A5"].value == 2
    assert ws_julho["D5"].value == "215027"
    assert ws_julho["E5"].value == 32754.00
    assert ws_julho["G5"].value == "N"

    # Validar integridade do workbook preenchido
    orig_wb = openpyxl.load_workbook(TEMPLATE_PATH, data_only=False)
    orig_fmap = FormulaGuard.extract_formula_map(orig_wb)
    FormulaGuard.verify_wb_integrity(orig_fmap, out_wb)
