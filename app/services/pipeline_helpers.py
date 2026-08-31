"""Funções puras e transformações reutilizadas pelo pipeline fiscal."""

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Mapping, Optional, Protocol, Union

from app.models.empresa import Empresa
from app.services.extraction.base import ExtractedNFData
from app.services.extraction.data_entrada_matcher import DataEntradaNormalizer


class SortableNote(Protocol):
    data_entrada: Optional[date]
    data_emissao: Union[date, datetime]
    numero_nota: str
    item_numero: int


SortableItem = Union[Mapping[str, Any], SortableNote]


def crossing_keys(nf: ExtractedNFData) -> list[str]:
    """Retorna chaves estáveis para unir a mesma NF-e vinda de XML e SPED."""
    keys: list[str] = []

    access_key = DataEntradaNormalizer.normalize_chave(nf.chave_acesso)
    if access_key:
        keys.append(f"chave:{access_key}")

    cnpj = DataEntradaNormalizer.normalize_cnpj(nf.cnpj_emitente)
    number = DataEntradaNormalizer.normalize_numero(nf.numero_nota)
    series = DataEntradaNormalizer.normalize_serie(nf.serie).lstrip("0")
    if cnpj and number:
        keys.append(f"tupla:{cnpj}|{series}|{number}")

    return keys


def enrich_sped_with_xml(nf_sped: ExtractedNFData, nf_xml: ExtractedNFData) -> None:
    """Complementa a nota do SPED com detalhes fiscais presentes no XML."""
    if not nf_sped or not nf_xml:
        return

    if not nf_sped.chave_acesso and nf_xml.chave_acesso:
        nf_sped.chave_acesso = nf_xml.chave_acesso

    if "crt" in nf_xml.raw_metadata:
        nf_sped.raw_metadata["crt"] = nf_xml.raw_metadata["crt"]

    if nf_xml.v_bc_nota > Decimal("0.00"):
        if (
            nf_sped.v_bc_nota in (Decimal("0.00"), nf_sped.v_total_nota)
            and nf_xml.v_bc_nota < nf_xml.v_total_nota
        ):
            nf_sped.v_bc_nota = nf_xml.v_bc_nota

    total_xml_expenses = sum(
        (item.ipi_despesas for item in nf_xml.itens), Decimal("0.00")
    )
    if total_xml_expenses <= Decimal("0.00"):
        return

    if len(nf_sped.itens) == len(nf_xml.itens):
        for sped_item, xml_item in zip(nf_sped.itens, nf_xml.itens):
            sped_item.ipi_despesas = xml_item.ipi_despesas
            if (
                sped_item.base_calculo == sped_item.v_total
                and Decimal("0.00") < xml_item.base_calculo < xml_item.v_total
            ):
                sped_item.base_calculo = xml_item.base_calculo
            if sped_item.descricao.startswith("Item ") and xml_item.descricao:
                sped_item.descricao = xml_item.descricao
        return

    if len(nf_sped.itens) == 1:
        sped_item = nf_sped.itens[0]
        sped_item.ipi_despesas = total_xml_expenses
        if (
            sped_item.base_calculo == sped_item.v_total
            and Decimal("0.00") < nf_xml.v_bc_nota < nf_xml.v_total_nota
        ):
            sped_item.base_calculo = nf_xml.v_bc_nota
        if sped_item.descricao.startswith("Item ") and nf_xml.itens:
            sped_item.descricao = nf_xml.itens[0].descricao or sped_item.descricao
        return

    distributed_expenses = Decimal("0.00")
    for sped_item in nf_sped.itens:
        if Decimal("0.00") < sped_item.base_calculo < sped_item.v_total:
            sped_item.ipi_despesas = sped_item.v_total - sped_item.base_calculo
            distributed_expenses += sped_item.ipi_despesas

    if distributed_expenses > Decimal("0.00"):
        discrepancy = total_xml_expenses - distributed_expenses
        if Decimal("-0.10") <= discrepancy <= Decimal("0.10") and discrepancy:
            nf_sped.itens[-1].ipi_despesas += discrepancy
        return

    total_value = sum((item.v_total for item in nf_sped.itens), Decimal("0.00"))
    if total_value > Decimal("0.00"):
        for sped_item in nf_sped.itens:
            sped_item.ipi_despesas = (
                sped_item.v_total / total_value
            ) * total_xml_expenses


def ignored_note(
    nf: ExtractedNFData,
    filename: str,
    reason: str,
) -> dict[str, Optional[str]]:
    """Monta o registro padronizado de uma nota desconsiderada."""
    return {
        "numero_nota": nf.numero_nota,
        "serie": nf.serie,
        "chave_acesso": nf.chave_acesso,
        "data_emissao": nf.data_emissao.strftime("%d/%m/%Y"),
        "motivo": reason,
        "arquivo": filename,
    }


def normalize_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    return None


def nfe_sort_key(item: SortableItem) -> tuple[datetime, datetime, int, int]:
    """Ordena por entrada, emissão, número da NF e subitem."""
    if isinstance(item, Mapping):
        entry_raw = item.get("data_entrada")
        issue_raw = item.get("data_emissao")
        number_raw = item.get("numero_nota", "")
        item_index = int(item.get("item_numero", 1))
    else:
        entry_raw = item.data_entrada
        issue_raw = item.data_emissao
        number_raw = item.numero_nota or ""
        item_index = int(item.item_numero or 1)

    entry_date = normalize_datetime(entry_raw)
    issue_date = normalize_datetime(issue_raw) or datetime.min
    principal_date = entry_date or issue_date
    number_digits = re.sub(r"\D", "", str(number_raw))
    number = int(number_digits) if number_digits else 0

    return principal_date, issue_date, number, item_index


def build_header_info(empresa: Empresa, periodo_inicio: date, ie: str) -> dict[str, Any]:
    return {
        "razao_social": empresa.razao_social,
        "cnpj": empresa.cnpj,
        "uf": empresa.uf,
        "ie": ie,
        "inscricao_estadual": ie,
        "competencia": periodo_inicio.strftime("%m/%Y"),
        "mes": periodo_inicio.month,
        "ano": periodo_inicio.year,
    }
