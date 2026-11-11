"""Funções puras e transformações reutilizadas pelo pipeline fiscal."""

import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Mapping, Optional, Protocol, Union

from app.constants import (
    MOTIVO_IMPOSTO_PAGO_ENTRADA,
    TIPO_EXCLUSAO_INDUSTRIA,
    TIPO_EXCLUSAO_MVA_PENDENTE,
)
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


CFOPS_USO_CONSUMO_ATIVO = {"2556", "2407", "2551", "1556", "1407", "1551"}
SUFIXOS_USO_CONSUMO_ATIVO = {"556", "407", "551"}


def is_cfop_uso_consumo_ativo(cfop: Optional[str]) -> bool:
    clean = re.sub(r"\D", "", cfop or "")
    if clean in CFOPS_USO_CONSUMO_ATIVO:
        return True
    if len(clean) >= 3 and clean[-3:] in SUFIXOS_USO_CONSUMO_ATIVO:
        return True
    return False


def aceita_difal_retroativa(nf: ExtractedNFData, optante_simples: bool, periodo_inicio: date) -> bool:
    """Nota emitida antes do período, mas escriturada no SPED do período.

    Só no Regime Normal a DIFAL de uso/consumo e ativo é apurada na entrada; no
    Simples Nacional ela já foi paga antecipadamente no mês da emissão.
    """
    if optante_simples or nf.origem_extracao != "sped" or nf.data_emissao is None:
        return False
    emissao = nf.data_emissao.date() if isinstance(nf.data_emissao, datetime) else nf.data_emissao
    return emissao < periodo_inicio


def aviso_difal_retroativa(nf: ExtractedNFData) -> str:
    return (
        f"Nota emitida antes do período ({nf.data_emissao.strftime('%d/%m/%Y')}) com entrada "
        "no SPED do período: apenas itens de DIFAL (uso/consumo e ativo) foram considerados."
    )


def enrich_sped_with_xml(nf_sped: ExtractedNFData, nf_xml: ExtractedNFData) -> None:
    """Complementa a nota do SPED com detalhes fiscais presentes no XML."""
    if not nf_sped or not nf_xml:
        return

    if not nf_sped.chave_acesso and nf_xml.chave_acesso:
        nf_sped.chave_acesso = nf_xml.chave_acesso

    if "icms_st_xml" in nf_xml.raw_metadata:
        nf_sped.raw_metadata["icms_st_xml"] = nf_xml.raw_metadata["icms_st_xml"]

    if "crt" in nf_xml.raw_metadata:
        nf_sped.raw_metadata["crt"] = nf_xml.raw_metadata["crt"]

    if "fornecedor_simples_nacional" in nf_xml.raw_metadata:
        nf_sped.raw_metadata["fornecedor_simples_nacional"] = nf_xml.raw_metadata["fornecedor_simples_nacional"]

    if "emit_nome" in nf_xml.raw_metadata and not nf_sped.raw_metadata.get("emit_nome"):
        nf_sped.raw_metadata["emit_nome"] = nf_xml.raw_metadata["emit_nome"]

    # Crédito de ICMS autorizado em Informações Complementares só existe no XML
    if nf_xml.aliq_credito_icms_inf_compl is not None:
        nf_sped.aliq_credito_icms_inf_compl = nf_xml.aliq_credito_icms_inf_compl

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
    # Exceção de Precedência Fiscal: CFOPs 2556, 2407 e 2551 (uso/consumo e ativo imobilizado)
    # somente existem na escrituração do destinatário no SPED (o emitente no XML fatura como 6101/6102/6403).
    # Nesses casos específicos, o CFOP do SPED tem precedência sobre o XML e direciona para DIFAL.
    if nf_xml.itens:
        sped_cfop_by_item = {
            it.item_numero: it.cfop
            for it in nf_sped.itens
            if it.cfop and is_cfop_uso_consumo_ativo(it.cfop)
        }
        sped_valid_cfops = [it.cfop for it in nf_sped.itens if it.cfop]
        all_sped_uso = (
            len(sped_valid_cfops) > 0
            and all(is_cfop_uso_consumo_ativo(c) for c in sped_valid_cfops)
        )
        predominant_sped_cfop = sped_valid_cfops[0] if sped_valid_cfops else "2556"

        new_itens = []
        for it in nf_xml.itens:
            it_copy = it.copy(deep=True)
            if all_sped_uso:
                it_copy.cfop = predominant_sped_cfop
            elif it.item_numero in sped_cfop_by_item:
                it_copy.cfop = sped_cfop_by_item[it.item_numero]
            new_itens.append(it_copy)

        nf_sped.itens = new_itens
        if nf_xml.v_total_nota > Decimal("0.00"):
            nf_sped.v_total_nota = nf_xml.v_total_nota
        if nf_xml.v_bc_nota > Decimal("0.00"):
            nf_sped.v_bc_nota = nf_xml.v_bc_nota
        if nf_xml.v_icms_nota > Decimal("0.00"):
            nf_sped.v_icms_nota = nf_xml.v_icms_nota
        if nf_xml.v_desc_nota > Decimal("0.00"):
            nf_sped.v_desc_nota = nf_xml.v_desc_nota
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


def serialize_excluded_item(
    nf: ExtractedNFData,
    item: Any,
    filename: str,
    destination: str,
    decision: Any,
) -> dict[str, Any]:
    """Converte uma decisão de exclusão no contrato persistido da solicitação."""
    optional_numeric_fields = (
        "v_total",
        "base_calculo",
        "ipi_despesas",
        "a_ori",
        "a_dst",
        "debito",
        "credito",
        "valor_devido",
    )
    serialized = {
        "chave_acesso": nf.chave_acesso,
        "numero_nota": nf.numero_nota,
        "serie": nf.serie,
        "item_numero": item.item_numero,
        "arquivo": filename,
        "destino": destination,
        "ncm": item.ncm,
        "descricao": item.descricao,
        "descricao_confiavel": item.descricao_confiavel,
        "motivo": decision.motivo,
        "tipo_exclusao": decision.tipo_exclusao,
        "regras_aplicadas": decision.regras_aplicadas,
    }
    serialized.update(
        {
            field: float(value) if (value := getattr(decision, field, None)) is not None else None
            for field in optional_numeric_fields
        }
    )
    return serialized


def is_imposto_pago_entrada(decision: Any) -> bool:
    """True quando a exclusão por mercadoria tem como motivo o imposto pago na entrada."""
    regras = getattr(decision, "regras_aplicadas", None) or []
    return bool(regras) and regras[0].get("motivo") == MOTIVO_IMPOSTO_PAGO_ENTRADA


def build_controle_row(
    nf: ExtractedNFData,
    item: Any,
    decision: Any,
    a_dst: Optional[Decimal],
    data_entrada: Any,
) -> dict[str, Any]:
    """Linha da planilha de controle: sem cálculo; O/P (pago/data) são manuais."""
    zero = Decimal("0.00")
    return {
        "numero_nota": nf.numero_nota,
        "serie": nf.serie,
        "chave_acesso": nf.chave_acesso,
        "cnpj_emitente": nf.cnpj_emitente,
        "uf_emitente": nf.uf_emitente,
        "cnpj_destinatario": nf.cnpj_destinatario,
        "uf_destinatario": None,
        "data_emissao": nf.data_emissao,
        "data_entrada": data_entrada,
        "item_numero": item.item_numero,
        "descricao": item.descricao,
        "ncm": item.ncm,
        "cfop": item.cfop,
        "v_total": decision.v_total,
        "base_calculo": decision.base_calculo,
        "ipi_despesas": decision.ipi_despesas,
        "mva": zero,
        "reducao": None,
        "red": "",
        "aliq_simples": "N",
        "a_ori": decision.a_ori,
        "a_dst": a_dst,
        "debito": zero,
        "credito": zero,
        "valor_devido": zero,
    }


def consolidar_linhas_controle(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Uma linha por nota e par de alíquotas (A.ORI, A.DST), com os valores somados.

    Mesma regra das demais planilhas: só há desdobramento quando a mesma nota tem
    alíquotas diferentes. Nesse caso, a partir do segundo grupo a nota recebe "*".
    """
    grupos: dict[tuple, list[dict[str, Any]]] = {}
    for row in rows:
        nota = (row["chave_acesso"] or row["numero_nota"], row["serie"], row["cnpj_emitente"])
        grupos.setdefault(nota + (row["a_ori"], row["a_dst"]), []).append(row)

    gerados: list[dict[str, Any]] = []
    por_nota: dict[tuple, int] = {}
    for chave, itens in grupos.items():
        nota = chave[:3]
        indice = por_nota.get(nota, 0) + 1
        por_nota[nota] = indice
        linha = dict(itens[0])
        linha["v_total"] = sum((i["v_total"] for i in itens), Decimal("0.00"))
        linha["base_calculo"] = sum((i["base_calculo"] for i in itens), Decimal("0.00"))
        linha["ipi_despesas"] = sum((i["ipi_despesas"] for i in itens), Decimal("0.00"))
        linha["data_entrada"] = next((i["data_entrada"] for i in itens if i["data_entrada"]), None)
        linha["item_numero"] = indice
        linha["numero_nota"] = f"{linha['numero_nota']}*" if indice > 1 else linha["numero_nota"]
        if len(itens) > 1:
            linha["descricao"] = f"NF-e {itens[0]['numero_nota']} ({len(itens)} itens)"
        gerados.append(linha)
    return gerados


def no_output_message(excluded_items: list[dict[str, Any]]) -> str:
    """Mensagem de uma solicitação concluída sem planilha, só com itens excluídos.

    Item com MVA pendente não é "nada a recolher": precisa de tratamento manual,
    então a mensagem diz isso em vez de indicar que não há imposto.
    """
    if excluded_items and all(
        item.get("tipo_exclusao") == TIPO_EXCLUSAO_INDUSTRIA for item in excluded_items
    ):
        return (
            "Nenhuma planilha gerada: empresa industrial sem itens de uso/consumo "
            "ou ativo imobilizado (DIFAL)"
        )
    pending =[item for item in excluded_items if item.get("tipo_exclusao") == TIPO_EXCLUSAO_MVA_PENDENTE]
    if not pending:
        return "Nenhum item a recolher na Parcial"
    if len(pending) == len(excluded_items):
        return (
            "Nenhuma planilha gerada: itens da Antecipação Tributária com MVA pendente "
            "precisam de tratamento manual (ver itens excluídos)"
        )
    return (
        "Nenhum item a recolher na Parcial, e há itens da Antecipação Tributária com MVA "
        "pendente que precisam de tratamento manual (ver itens excluídos)"
    )


def normalize_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    return None


def nfe_sort_key(item: SortableItem) -> tuple[datetime, int, datetime, int]:
    """Ordena por dia de entrada, número numérico da NF, emissão e subitem."""
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
    # Sem entrada comprovada, usa apenas o DIA de emissão para ordenar,
    # sem inferir/preencher uma data de entrada na planilha.
    principal_date = entry_date or issue_date
    principal_day = datetime.combine(principal_date.date(), datetime.min.time())
    number_digits = re.sub(r"\D", "", str(number_raw))
    number = int(number_digits) if number_digits else 0

    return principal_day, number, issue_date, item_index


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


MODELO_OFICIAL_POR_TIPO = {
    "antecipacao_parcial": "RP-153",
    "antecipacao_parcial_antecipado": "RP-155",
    "antecipacao_parcial_simples": "RP-154",
    "antecipacao_parcial_antecipado_simples": "RP-156",
    "antecipacao_tributaria": "RP-151",
    "antecipacao_tributaria_antecipado": "RP-151",
    "difal": "RP-158",
    "difal_antecipado": "RP-158",
    "controle_imposto_pago_entrada": "Controle",
}

TIPO_PLANILHA_CURTO = {
    "antecipacao_parcial": "Parcial",
    "antecipacao_parcial_antecipado": "Parcial-Antecipado",
    "antecipacao_parcial_simples": "Parcial-Simples",
    "antecipacao_parcial_antecipado_simples": "Parcial-Ant-Simples",
    "antecipacao_tributaria": "AT",
    "antecipacao_tributaria_antecipado": "AT-Antecipado",
    "difal": "DIFAL",
    "difal_antecipado": "DIFAL-Antecipado",
    "controle_imposto_pago_entrada": "Imposto-Pago-Entrada",
}

CORPORATE_SUFFIXES = {
    "LTDA",
    "ME",
    "EPP",
    "EIRELI",
    "SA",
    "CIA",
    "COMPANHIA",
    "MEI",
    "UNIPESSOAL",
    "SOCIEDADE",
    "INDIVIDUAL",
    "EIRELI-ME",
    "LTDA-ME",
    "LTDA-EPP",
}

STOP_WORDS = {"DE", "DA", "DO", "DAS", "DOS", "E", "PARA", "COM", "EM"}


def sanitize_company_name(raw_name: str, max_length: int = 18) -> str:
    """Higieniza a razão social para um nome curto, legível e seguro para sistemas de arquivos."""
    if not raw_name or not isinstance(raw_name, str):
        return "Empresa"

    normalized = unicodedata.normalize("NFD", raw_name)
    without_accents = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    cleaned = re.sub(r"\bS\s*[/.]\s*A\b\.?", " ", without_accents, flags=re.IGNORECASE)
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)

    words = [w.strip() for w in cleaned.split() if w.strip()]
    if not words:
        return "Empresa"

    filtered_words = [w for w in words if w.upper() not in CORPORATE_SUFFIXES]
    candidate_words = filtered_words if filtered_words else words

    result = ""
    for word in candidate_words:
        upper = word.upper()
        if result and upper in STOP_WORDS:
            continue
        formatted = word.capitalize()
        if len(result) + len(formatted) <= max_length:
            result += formatted
        else:
            if not result:
                result = formatted[:max_length]
            break

    return result or "Empresa"


def resolve_modelo_planilha(tipo: str, observacoes: Optional[str] = None) -> str:
    """Resolve o modelo oficial SEFAZ (ex: RP-153) via observações ou tipo."""
    if observacoes:
        match = re.search(r"\bRP[- ]?(\d+)\b", observacoes, flags=re.IGNORECASE)
        if match:
            return f"RP-{match.group(1)}"
    return MODELO_OFICIAL_POR_TIPO.get(tipo, "RP")


def resolve_tipo_curto(tipo: str) -> str:
    """Converte o identificador interno da planilha em uma sigla/nome conciso."""
    return TIPO_PLANILHA_CURTO.get(tipo, re.sub(r"^antecipacao_", "", tipo).upper())


def format_competencia_nome(month: Union[int, str], year: Union[int, str]) -> str:
    """Formata a competência no padrão MM-AAAA."""
    m = re.sub(r"\D", "", str(month)).zfill(2)
    y = re.sub(r"\D", "", str(year))
    return f"{m}-{y}"


def build_spreadsheet_filename(
    razao_social: str,
    tipo: str,
    month: Union[int, str],
    year: Union[int, str],
    observacoes: Optional[str] = None,
) -> str:
    """Monta o nome amigável da planilha gerada: [Modelo]_[Empresa]_[Tipo]_[MM-AAAA].xlsx."""
    empresa = sanitize_company_name(razao_social)
    modelo = resolve_modelo_planilha(tipo, observacoes)
    tipo_curto = resolve_tipo_curto(tipo)
    competencia = format_competencia_nome(month, year)
    return f"{modelo}_{empresa}_{tipo_curto}_{competencia}.xlsx"

