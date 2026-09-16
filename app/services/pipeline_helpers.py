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

    if "emit_nome" in nf_xml.raw_metadata and not nf_sped.raw_metadata.get("emit_nome"):
        nf_sped.raw_metadata["emit_nome"] = nf_xml.raw_metadata["emit_nome"]

    if nf_xml.v_bc_nota > Decimal("0.00"):
        if (
            nf_sped.v_bc_nota in (Decimal("0.00"), nf_sped.v_total_nota)
            and nf_xml.v_bc_nota < nf_xml.v_total_nota
        ):
            nf_sped.v_bc_nota = nf_xml.v_bc_nota

    # O XML oficial da SEFAZ é o documento fiscal autorizativo e a fonte fidedigna
    # para os itens da mercadoria (NCM oficial, descrição da indústria, alíquota de origem
    # interestadual de ICMS e valores comerciais reais).
    # O SPED Fiscal é a fonte contábil que comprova a entrada física no estabelecimento
    # (data_entrada extraída do campo DT_E_S do Registro C100).
    # Portanto, havendo itens no XML da SEFAZ, adota-se a lista completa e oficial de itens do XML,
    # preservando a data de entrada e os metadados de escrituração do SPED.
    if nf_xml.itens:
        nf_sped.itens = [it.copy(deep=True) for it in nf_xml.itens]
        if nf_xml.v_total_nota > Decimal("0.00"):
            nf_sped.v_total_nota = nf_xml.v_total_nota
        if nf_xml.v_bc_nota > Decimal("0.00"):
            nf_sped.v_bc_nota = nf_xml.v_bc_nota
        if nf_xml.v_icms_nota > Decimal("0.00"):
            nf_sped.v_icms_nota = nf_xml.v_icms_nota
        return


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
