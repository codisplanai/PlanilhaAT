import copy
import os
import re
from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional

import openpyxl
from openpyxl.utils import column_index_from_string
try:
    from PIL import Image as PILImage
except ImportError:
    PILImage = None

from app.core.exceptions import PlanilhaATException, ValidationException
from app.services.excel.formula_guard import FormulaGuard
from app.services.excel.template_utils import build_header_text, format_excel_value, select_worksheet
from app.services.local_files import atomic_write


class TemplateFiller:
    """Preenche apenas as células mapeadas e preserva as fórmulas do modelo."""

    @staticmethod
    def _is_formula_cell(cell: Any) -> bool:
        return (
            cell.value is not None
            and isinstance(cell.value, str)
            and cell.value.startswith("=")
        ) or cell.data_type == "f"

    @staticmethod
    def _is_totals_row(worksheet: Any, row_idx: int) -> bool:
        max_col = worksheet.max_column or 0
        for col_idx in range(1, max_col + 1):
            val = worksheet.cell(row=row_idx, column=col_idx).value
            if not isinstance(val, str):
                continue
            upper = val.strip().upper()
            if upper.startswith("=") and any(
                fn in upper for fn in ("SUM(", "SOMA(", "SUBTOTAL(")
            ):
                return True
            if upper in {"TOTAL", "TOTAL:", "TOTALIZADOR", "TOTALIZADOR:", "TOTAIS", "TOTAIS:"}:
                return True
        return False

    @staticmethod
    def _should_rename_to_competence(title: str) -> bool:
        stripped = title.strip()
        return bool(
            re.match(r"^\d{2}[-_./]\d{4}", stripped)
            or re.match(r"^\d{1,2}$", stripped)
            or stripped.lower() in {"sheet1", "planilha1", "sheet"}
        )

    @staticmethod
    def _resolve_column_indices(mapping: Dict[str, Any]) -> Dict[str, int]:
        columns_map = dict(mapping.get("columns", {}))
        if "mva" in columns_map and columns_map.get("a_dst") == "J":
            columns_map.setdefault("reducao", "I")
            columns_map.setdefault("valor_pago", "S")
        column_indices: Dict[str, int] = {}
        for field, column_letter in columns_map.items():
            try:
                column_indices[field] = column_index_from_string(column_letter)
            except (TypeError, ValueError) as exc:
                raise ValidationException(
                    f"Letra de coluna inválida '{column_letter}' para o campo '{field}'."
                ) from exc
        return column_indices

    @classmethod
    def _clear_residual_rows(
        cls,
        *,
        worksheet: Any,
        start_cleanup_row: int,
        clearable_columns: Iterable[int],
    ) -> None:
        max_row = worksheet.max_row or 0
        cols = sorted(set(clearable_columns))
        if start_cleanup_row > max_row or not cols:
            return
        for row_idx in range(start_cleanup_row, max_row + 1):
            if cls._is_totals_row(worksheet, row_idx):
                break
            for col_idx in cols:
                cell = worksheet.cell(row=row_idx, column=col_idx)
                if not cls._is_formula_cell(cell) and cell.value is not None:
                    cell.value = None

    @classmethod
    def _fill_worksheet(
        cls,
        *,
        worksheet: Any,
        rows_data: List[Dict[str, Any]],
        header_cell: Optional[str],
        header_info: Optional[Dict[str, Any]],
        start_row: int,
        column_indices: Dict[str, int],
        percentage_format: str,
    ) -> None:
        if header_cell and header_info:
            try:
                worksheet[header_cell] = build_header_text(header_info)
            except (KeyError, TypeError, ValueError) as exc:
                raise ValidationException(f"Célula de cabeçalho inválida: '{header_cell}'.") from exc

        for index, source_row in enumerate(rows_data):
            current_row = start_row + index
            row = dict(source_row)
            row.setdefault("item_index", index + 1)
            written_cols: set[int] = set()
            for field_name, column_index in column_indices.items():
                raw_value = row.get(field_name)
                cell = worksheet.cell(row=current_row, column=column_index)
                if cls._is_formula_cell(cell):
                    if raw_value is None or field_name == "base_calculo":
                        continue
                    FormulaGuard.assert_no_formula_overwrite(
                        worksheet, current_row, column_index, field_name
                    )
                if raw_value is None:
                    if field_name != "item_index" and column_index not in written_cols:
                        cell.value = None
                    continue
                cell.value = format_excel_value(field_name, raw_value, percentage_format)
                written_cols.add(column_index)

        clearable_columns = [
            column_index
            for field_name, column_index in column_indices.items()
            if field_name != "item_index"
        ]
        cls._clear_residual_rows(
            worksheet=worksheet,
            start_cleanup_row=start_row + len(rows_data),
            clearable_columns=clearable_columns,
        )

    @staticmethod
    def _copy_sheet_images(source_sheet: Any, target_sheet: Any) -> None:
        for donor_img in getattr(source_sheet, "_images", ()):
            try:
                if isinstance(donor_img.ref, BytesIO):
                    buf = BytesIO(donor_img.ref.getvalue())
                elif PILImage is not None:
                    pil_img = (
                        donor_img.ref
                        if hasattr(donor_img.ref, "save")
                        else PILImage.open(donor_img.ref)
                    )
                    buf = BytesIO()
                    pil_img.save(buf, format=getattr(donor_img, "format", None) or "PNG")
                    buf.seek(0)
                else:
                    continue
                new_img = openpyxl.drawing.image.Image(buf)
                anchor = getattr(donor_img, "anchor", None)
                new_img.anchor = copy.deepcopy(anchor) if anchor is not None else "B1"
                if getattr(donor_img, "width", None):
                    new_img.width = donor_img.width
                if getattr(donor_img, "height", None):
                    new_img.height = donor_img.height
                target_sheet.add_image(new_img)
            except Exception:
                pass

    @classmethod
    def fill_template(
        cls,
        template_path: str,
        mapping: Dict[str, Any],
        rows_data: List[Dict[str, Any]],
        output_path: str,
        header_info: Optional[Dict[str, Any]] = None,
        fcp_rows: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        if not os.path.exists(template_path):
            raise ValidationException(
                f"Arquivo de template não encontrado: '{os.path.basename(template_path)}'."
            )

        workbook = None
        try:
            workbook = openpyxl.load_workbook(template_path, data_only=False)
            original_formula_map = FormulaGuard.extract_formula_map(workbook)
            worksheet, month, year = select_worksheet(
                workbook, mapping, rows_data or fcp_rows or [], header_info
            )
            original_title = worksheet.title

            # Clona antes do preenchimento e antes da remoção das abas extras.
            fcp_worksheet = workbook.copy_worksheet(worksheet) if fcp_rows else None

            # Preservação de logo/imagem: se a aba selecionada não tiver imagens mas outra aba contiver,
            # transfere para ela; e replica em bytes independentes para a aba FCP clonada.
            if not getattr(worksheet, "_images", None):
                for other_sheet in workbook.worksheets:
                    if other_sheet not in (worksheet, fcp_worksheet) and getattr(
                        other_sheet, "_images", None
                    ):
                        cls._copy_sheet_images(other_sheet, worksheet)
                        break
            if (
                fcp_worksheet is not None
                and not getattr(fcp_worksheet, "_images", None)
                and getattr(worksheet, "_images", None)
            ):
                cls._copy_sheet_images(worksheet, fcp_worksheet)

            header_cell = (
                mapping.get("header_cell")
                or mapping.get("extra_options", {}).get("header_cell")
                or "A2"
            )
            start_row = int(mapping.get("start_row", 4))
            column_indices = cls._resolve_column_indices(mapping)
            percentage_format = mapping.get("aliquota_format") or mapping.get(
                "extra_options", {}
            ).get("aliquota_format", "decimal")

            cls._fill_worksheet(
                worksheet=worksheet,
                rows_data=rows_data,
                header_cell=header_cell,
                header_info=header_info,
                start_row=start_row,
                column_indices=column_indices,
                percentage_format=percentage_format,
            )
            if fcp_worksheet is not None and fcp_rows:
                cls._fill_worksheet(
                    worksheet=fcp_worksheet,
                    rows_data=fcp_rows,
                    header_cell=header_cell,
                    header_info=header_info,
                    start_row=start_row,
                    column_indices=column_indices,
                    percentage_format=percentage_format,
                )

            kept_sheets = {worksheet} if fcp_worksheet is None else {worksheet, fcp_worksheet}
            for other_sheet in [sheet for sheet in workbook.worksheets if sheet not in kept_sheets]:
                workbook.remove(other_sheet)
            workbook.active = worksheet

            if month and year:
                competence_title = f"{month:02d}-{year}"
                if cls._should_rename_to_competence(worksheet.title):
                    worksheet.title = competence_title
                if fcp_worksheet is not None:
                    fcp_worksheet.title = f"{competence_title} FCP"
            elif fcp_worksheet is not None:
                fcp_worksheet.title = (
                    f"{original_title[:27]} FCP"
                    if len(original_title) > 27
                    else f"{original_title} FCP"
                )

            orig_sheet_formulas = original_formula_map.get(original_title, {})
            expected_formula_map = {worksheet.title: orig_sheet_formulas}
            if fcp_worksheet is not None:
                expected_formula_map[fcp_worksheet.title] = orig_sheet_formulas
            FormulaGuard.verify_wb_integrity(expected_formula_map, workbook)

            if getattr(workbook, "calculation", None) is not None:
                workbook.calculation.fullCalcOnLoad = True
                workbook.calculation.forceFullCalc = True
                workbook.calculation.calcMode = "auto"

            output_buffer = BytesIO()
            workbook.save(output_buffer)
            workbook.close()
            workbook = None
            return atomic_write(output_path, output_buffer.getvalue(), prefix="planilha_")
        except PlanilhaATException:
            raise
        except Exception as exc:
            raise ValidationException("Não foi possível preencher o template Excel.") from exc
        finally:
            if workbook is not None:
                workbook.close()
