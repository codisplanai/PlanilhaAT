import os
import pytest
import openpyxl
from decimal import Decimal
from datetime import datetime, date

from app.services.excel.template_filler import TemplateFiller
from app.services.excel.formula_guard import FormulaGuard
from app.core.exceptions import TemplateIntegrityException

def test_preenchimento_excel_preserva_todas_formulas(create_sample_excel_template, tmp_path):
    template_path = create_sample_excel_template("antecipacao_parcial")
    output_path = str(tmp_path / "output_test.xlsx")

    # Mapeamento estrito para as colunas de ENTRADA (A, B, C, D, E, F, G)
    # Colunas com fórmulas (H, I, J) NÃO são escritas diretamente pelo sistema
    mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {
            "numero_nota": "A",
            "data_emissao": "B",
            "ncm": "C",
            "v_total": "D",
            "base_calculo": "E",
            "a_ori": "F",
            "a_dst": "G"
        }
    }

    # Dados a preencher em 2 linhas (linhas 4 e 5)
    rows_data = [
        {
            "numero_nota": "1001",
            "data_emissao": date(2026, 1, 10),
            "ncm": "84713012",
            "v_total": Decimal("5000.00"),
            "base_calculo": Decimal("5000.00"),
            "a_ori": Decimal("0.1200"),
            "a_dst": Decimal("0.2050")
        },
        {
            "numero_nota": "1002",
            "data_emissao": date(2026, 1, 12),
            "ncm": "39269090",
            "v_total": Decimal("2500.00"),
            "base_calculo": Decimal("2000.00"),
            "a_ori": Decimal("0.1200"),
            "a_dst": Decimal("0.1800")
        }
    ]

    # Carregar original e extrair o mapa de fórmulas antes do preenchimento
    wb_orig = openpyxl.load_workbook(template_path, data_only=False)
    orig_formulas = FormulaGuard.extract_formula_map(wb_orig)
    wb_orig.close()

    # Executar o preenchimento
    TemplateFiller.fill_template(
        template_path=template_path,
        mapping=mapping,
        rows_data=rows_data,
        output_path=output_path
    )

    # Abrir a planilha de saída e inspecionar célula a célula
    wb_out = openpyxl.load_workbook(output_path, data_only=False)
    ws_out = wb_out["Planilha AT"]

    # 1. Conferir valores de entrada escritos
    assert ws_out["A4"].value == "1001"
    if isinstance(ws_out["B4"].value, (datetime, date)):
        assert ws_out["B4"].value.strftime("%d/%m/%Y") == "10/01/2026"
    else:
        assert ws_out["B4"].value == "10/01/2026"
    assert ws_out["C4"].value == "84713012"
    assert float(ws_out["D4"].value) == 5000.0
    assert float(ws_out["E4"].value) == 5000.0
    assert float(ws_out["F4"].value) == 0.12
    assert float(ws_out["G4"].value) == 0.205

    assert ws_out["A5"].value == "1002"
    assert float(ws_out["D5"].value) == 2500.0

    # 2. Conferir que as fórmulas originais das linhas 4 e 5 continuam INTACTAS
    assert ws_out["H4"].value == "=D4*G4"
    assert ws_out["I4"].value == "=E4*F4"
    assert ws_out["J4"].value == "=H4-I4"

    assert ws_out["H5"].value == "=D5*G5"
    assert ws_out["I5"].value == "=E5*F5"
    assert ws_out["J5"].value == "=H5-I5"

    # 3. Conferir que os totalizadores de rodapé continuam com fórmulas INTACTAS
    assert ws_out["D12"].value == "=SUM(D4:D10)"
    assert ws_out["E12"].value == "=SUM(E4:E10)"
    assert ws_out["H12"].value == "=SUM(H4:H10)"
    assert ws_out["I12"].value == "=SUM(I4:I10)"
    assert ws_out["J12"].value == "=SUM(J4:J10)"

    # 4. Verificação de integridade 100% via FormulaGuard
    FormulaGuard.verify_wb_integrity(orig_formulas, wb_out)
    wb_out.close()

def test_bloqueio_de_sobrescrita_acidental_de_formula(create_sample_excel_template, tmp_path):
    template_path = create_sample_excel_template("antecipacao_parcial")
    output_path = str(tmp_path / "output_fail.xlsx")

    # Mapeamento com erro: tenta mapear 'v_total' para a coluna H (que contém a fórmula =D4*G4)
    bad_mapping = {
        "start_row": 4,
        "sheet_name": "Planilha AT",
        "columns": {
            "v_total": "H" # Coluna H tem fórmula!
        }
    }

    rows_data = [{"v_total": Decimal("1000.00")}]

    with pytest.raises(TemplateIntegrityException) as exc_info:
        TemplateFiller.fill_template(
            template_path=template_path,
            mapping=bad_mapping,
            rows_data=rows_data,
            output_path=output_path
        )

    assert "Tentativa de sobrescrever fórmula na célula H4" in str(exc_info.value)
    # Garante que o arquivo de saída não foi gerado/corrompido
    assert not os.path.exists(output_path)
