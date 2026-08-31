import os
import re
from typing import List, Dict, Any, Optional
import openpyxl
from openpyxl.utils import column_index_from_string

from app.core.exceptions import TemplateIntegrityException, ValidationException
from app.services.excel.formula_guard import FormulaGuard
from app.services.excel.template_utils import (
    build_header_text,
    format_excel_value,
    select_worksheet,
)

class TemplateFiller:
    """
    Camada 8: Preenchimento do template .xlsx com os dados extraídos e processados.
    Escreve ESTRITAMENTE em células de entrada mapeadas, mantendo todas as fórmulas originais intactas.
    """

    @classmethod
    def fill_template(
        cls,
        template_path: str,
        mapping: Dict[str, Any],
        rows_data: List[Dict[str, Any]],
        output_path: str,
        header_info: Optional[Dict[str, Any]] = None
    ) -> str:
        if not os.path.exists(template_path):
            raise ValidationException(f"Arquivo de template não encontrado no caminho: '{template_path}'")

        # Abrir template preservando fórmulas (data_only=False)
        wb = openpyxl.load_workbook(template_path, data_only=False)

        # 1. Mapear todas as fórmulas originais antes de qualquer escrita
        original_formula_map = FormulaGuard.extract_formula_map(wb)

        ws, mes_idx, ano_val = select_worksheet(wb, mapping, rows_data, header_info)

        original_ws_title = ws.title

        # 2. Preenchimento de cabeçalho da Empresa / Inscrição Estadual / Competência
        header_cell = mapping.get("header_cell") or mapping.get("extra_options", {}).get("header_cell") or "A2"
        if header_cell and header_info:
            try:
                ws[header_cell] = build_header_text(header_info)
            except Exception:
                pass

        start_row = int(mapping.get("start_row", 4))
        columns_map = mapping.get("columns", {})
        aliquota_format = mapping.get("aliquota_format") or mapping.get("extra_options", {}).get("aliquota_format", "decimal")

        # Converter letras de colunas para índices numéricos 1-based
        col_indices: Dict[str, int] = {}
        for field, col_letter in columns_map.items():
            try:
                col_indices[field] = column_index_from_string(col_letter)
            except ValueError:
                raise ValidationException(f"Letra de coluna inválida '{col_letter}' para o campo '{field}' no mapeamento.")

        # Preencher linha a linha
        for idx, row_item in enumerate(rows_data):
            current_row = start_row + idx

            # Injetar item_index se mapeado
            if "item_index" in col_indices and "item_index" not in row_item:
                row_item["item_index"] = idx + 1

            for field_name, col_idx in col_indices.items():
                if field_name not in row_item:
                    continue

                raw_value = row_item[field_name]
                if raw_value is None:
                    continue

                # Garantir que a célula NÃO contém fórmula antes de escrever
                FormulaGuard.assert_no_formula_overwrite(ws, current_row, col_idx, field_name)

                cell = ws.cell(row=current_row, column=col_idx)
                cell.value = format_excel_value(field_name, raw_value, aliquota_format)

        # 3. Manter APENAS a aba da competência processada e remover todas as demais abas
        for other_sheet in [s for s in wb.worksheets if s != ws]:
            wb.remove(other_sheet)

        # Renomear a aba com a competência do mês processado (ex: "03-2026", "04-2026")
        if mes_idx and ano_val:
            comp_tab_name = f"{mes_idx:02d}-{ano_val}"
            # Se a aba original tem formato numérico de competência (ex: "03-2026", "04-2026 FCP")
            # ou nome genérico padrão (ex: "Sheet1", "Planilha1"), renomeia para a competência processada:
            if re.match(r"^\d{2}[-_/]\d{4}", ws.title) or ws.title.strip().lower() in ["sheet1", "planilha1", "sheet"]:
                ws.title = comp_tab_name

        # 4. Verificação final de integridade de 100% das fórmulas originais da aba processada
        single_sheet_formula_map = {ws.title: original_formula_map.get(original_ws_title, {})}
        FormulaGuard.verify_wb_integrity(single_sheet_formula_map, wb)

        # 5. Salvar o arquivo resultante com aba única
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        wb.save(output_path)
        wb.close()

        return output_path
