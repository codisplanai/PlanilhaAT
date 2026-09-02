import os
import re
import tempfile
from io import BytesIO
from typing import Any, Dict, List, Optional

import openpyxl
from openpyxl.utils import column_index_from_string
try:
    from PIL import Image as PILImage
except ImportError:
    PILImage = None

from app.core.exceptions import PlanilhaATException, ValidationException
from app.services.excel.formula_guard import FormulaGuard
from app.services.excel.template_utils import build_header_text, format_excel_value, select_worksheet


class TemplateFiller:
    """Preenche apenas as células mapeadas e preserva as fórmulas do modelo."""

    @classmethod
    def fill_template(
        cls,
        template_path: str,
        mapping: Dict[str, Any],
        rows_data: List[Dict[str, Any]],
        output_path: str,
        header_info: Optional[Dict[str, Any]] = None,
    ) -> str:
        if not os.path.exists(template_path):
            raise ValidationException(f"Arquivo de template não encontrado: '{os.path.basename(template_path)}'.")

        workbook = None
        temporary_path: Optional[str] = None
        try:
            workbook = openpyxl.load_workbook(template_path, data_only=False)
            original_formula_map = FormulaGuard.extract_formula_map(workbook)
            worksheet, month, year = select_worksheet(workbook, mapping, rows_data, header_info)
            original_title = worksheet.title

            header_cell = mapping.get("header_cell") or mapping.get("extra_options", {}).get("header_cell") or "A2"
            if header_cell and header_info:
                try:
                    worksheet[header_cell] = build_header_text(header_info)
                except (KeyError, TypeError, ValueError) as exc:
                    raise ValidationException(f"Célula de cabeçalho inválida: '{header_cell}'.") from exc

            start_row = int(mapping.get("start_row", 4))
            columns_map = mapping.get("columns", {})
            percentage_format = mapping.get("aliquota_format") or mapping.get("extra_options", {}).get(
                "aliquota_format", "decimal"
            )
            column_indices: Dict[str, int] = {}
            for field, column_letter in columns_map.items():
                try:
                    column_indices[field] = column_index_from_string(column_letter)
                except (TypeError, ValueError) as exc:
                    raise ValidationException(
                        f"Letra de coluna inválida '{column_letter}' para o campo '{field}'."
                    ) from exc

            for index, source_row in enumerate(rows_data):
                current_row = start_row + index
                row = dict(source_row)
                row.setdefault("item_index", index + 1)
                for field_name, column_index in column_indices.items():
                    raw_value = row.get(field_name)
                    if raw_value is None:
                        continue
                    FormulaGuard.assert_no_formula_overwrite(worksheet, current_row, column_index, field_name)
                    worksheet.cell(row=current_row, column=column_index).value = format_excel_value(
                        field_name, raw_value, percentage_format
                    )

            # Preservação de logo/imagem: se a aba selecionada não tiver imagens mas outra aba contiver,
            # transfere a imagem para a aba selecionada antes de remover as demais abas.
            if PILImage and not getattr(worksheet, "_images", None):
                for other_sheet in workbook.worksheets:
                    if other_sheet != worksheet and getattr(other_sheet, "_images", None):
                        for donor_img in other_sheet._images:
                            try:
                                pil_img = (
                                    donor_img.ref
                                    if hasattr(donor_img.ref, "save")
                                    else PILImage.open(donor_img.ref)
                                )
                                buf = BytesIO()
                                pil_img.save(buf, format=getattr(donor_img, "format", None) or "PNG")
                                buf.seek(0)
                                new_img = openpyxl.drawing.image.Image(buf)
                                new_img.anchor = getattr(donor_img, "anchor", "B1") or "B1"
                                worksheet.add_image(new_img)
                            except Exception:
                                pass
                        break

            for other_sheet in [sheet for sheet in workbook.worksheets if sheet != worksheet]:
                workbook.remove(other_sheet)

            if month and year:
                competence_title = f"{month:02d}-{year}"
                if re.match(r"^\d{2}[-_/]\d{4}", worksheet.title) or worksheet.title.strip().lower() in {
                    "sheet1",
                    "planilha1",
                    "sheet",
                }:
                    worksheet.title = competence_title

            single_sheet_formula_map = {worksheet.title: original_formula_map.get(original_title, {})}
            FormulaGuard.verify_wb_integrity(single_sheet_formula_map, workbook)

            output_directory = os.path.dirname(os.path.abspath(output_path))
            os.makedirs(output_directory, exist_ok=True)
            descriptor, temporary_path = tempfile.mkstemp(prefix="planilha_", suffix=".xlsx", dir=output_directory)
            os.close(descriptor)
            workbook.save(temporary_path)
            workbook.close()
            workbook = None
            os.replace(temporary_path, output_path)
            temporary_path = None
            return output_path
        except PlanilhaATException:
            raise
        except Exception as exc:
            raise ValidationException("Não foi possível preencher o template Excel.") from exc
        finally:
            if workbook is not None:
                workbook.close()
            if temporary_path and os.path.exists(temporary_path):
                os.remove(temporary_path)
