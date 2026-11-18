from decimal import Decimal
import re
from typing import List, Tuple
import xml.etree.ElementTree as ET

from app.core.exceptions import ValidationException
from app.services.extraction.base import ExtractedCTeData, IBGE_UF_MAP
from app.services.extraction.xml_utils import (
    find_elem,
    find_first_descendant,
    get_decimal,
    get_text,
    parse_sefaz_datetime,
    parse_xml_root,
    strip_tag,
)

_TOMA_TAG_MAP = {
    "0": "rem",
    "1": "exped",
    "2": "receb",
    "3": "dest",
}


class CTeXMLExtractor:
    """Extrator determinístico de dados de CT-e (modelo 57) a partir do XML SEFAZ."""

    @staticmethod
    def is_cte_xml(xml_content: bytes) -> bool:
        try:
            root = ET.fromstring(xml_content)
        except Exception:
            return False
        return find_first_descendant(root, "infCte") is not None

    @staticmethod
    def _extract_tomador(inf_cte: ET.Element, ide: ET.Element) -> Tuple[str, str]:
        """Resolve (toma_codigo, cnpj_tomador) a partir de <toma4> ou <toma3>/<toma03>."""
        toma4 = find_elem(ide, "toma4")
        if toma4 is None:
            toma4 = find_elem(ide, "toma04")
        if toma4 is not None:
            raw_doc = get_text(toma4, "CNPJ") or get_text(toma4, "CPF")
            return get_text(toma4, "toma") or "4", re.sub(r"\D", "", raw_doc)

        toma3 = find_elem(ide, "toma3")
        if toma3 is None:
            toma3 = find_elem(ide, "toma03")
        toma_codigo = get_text(toma3, "toma") if toma3 is not None else get_text(ide, "toma")
        papel_tag = _TOMA_TAG_MAP.get(toma_codigo)
        if not papel_tag:
            return toma_codigo, ""

        papel_elem = find_elem(inf_cte, papel_tag)
        raw_doc = get_text(papel_elem, "CNPJ") or get_text(papel_elem, "CPF")
        return toma_codigo, re.sub(r"\D", "", raw_doc)

    @staticmethod
    def _extract_icms(inf_cte: ET.Element, crt: str) -> Tuple[Decimal, Decimal, bool, Decimal, bool]:
        """Extrai (v_bc, a_ori, a_ori_destacada, v_icms, is_simples) de <imp><ICMS>."""
        imp = find_elem(inf_cte, "imp")
        icms = find_elem(imp, "ICMS")
        v_bc = Decimal("0.00")
        p_icms = Decimal("0.00")
        v_icms = Decimal("0.00")
        is_simples = crt in ("1", "2", "4")

        if icms is not None:
            for group in icms:
                group_tag = strip_tag(group.tag)
                if group_tag == "ICMSSN" or get_text(group, "indSN") == "1":
                    is_simples = True
                v_bc = get_decimal(group, "vBC") or get_decimal(group, "vBCOutraUF")
                p_icms = get_decimal(group, "pICMS") or get_decimal(group, "pICMSOutraUF")
                v_icms = get_decimal(group, "vICMS") or get_decimal(group, "vICMSOutraUF")
                break

        a_ori_destacada = p_icms > Decimal("0.00")
        a_ori = (
            (p_icms / Decimal("100.0") if p_icms > Decimal("1") else p_icms)
            if a_ori_destacada
            else Decimal("0.00")
        )
        return v_bc, a_ori, a_ori_destacada, v_icms, is_simples

    @staticmethod
    def _extract_chaves_nfe(inf_cte: ET.Element) -> List[str]:
        """Coleta chaves de 44 dígitos das NF-es originárias em <infNFe><chave>."""
        chaves: List[str] = []
        seen = set()
        for elem in inf_cte.iter():
            if strip_tag(elem.tag) != "infNFe":
                continue
            chave = re.sub(r"\D", "", get_text(elem, "chave"))
            if len(chave) == 44 and chave not in seen:
                seen.add(chave)
                chaves.append(chave)
        return chaves

    def extract_from_xml(self, xml_content: bytes) -> ExtractedCTeData:
        root = parse_xml_root(xml_content, "do CT-e")
        inf_cte = find_first_descendant(root, "infCte")
        if inf_cte is None:
            raise ValidationException("Estrutura do XML não contém a tag obrigatória <infCte>.")

        chave_acesso = re.sub(r"\D", "", inf_cte.attrib.get("Id", ""))
        if len(chave_acesso) != 44:
            inf_prot = find_first_descendant(root, "infProt")
            chave_prot = re.sub(r"\D", "", get_text(inf_prot, "chCTe"))
            if len(chave_prot) == 44:
                chave_acesso = chave_prot

        ide = find_elem(inf_cte, "ide")
        if ide is None:
            raise ValidationException("Estrutura do XML do CT-e não contém <ide>.")

        numero_cte = get_text(ide, "nCT")
        serie = get_text(ide, "serie")
        cfop = get_text(ide, "CFOP")
        uf_inicio = get_text(ide, "UFIni").upper()
        uf_fim = get_text(ide, "UFFim").upper()
        data_emissao = parse_sefaz_datetime(
            get_text(ide, "dhEmi") or get_text(ide, "dEmi"),
            "do CT-e",
        )

        toma_codigo, cnpj_tomador = self._extract_tomador(inf_cte, ide)

        emit = find_elem(inf_cte, "emit")
        cnpj_emitente = re.sub(r"\D", "", get_text(emit, "CNPJ") or get_text(emit, "CPF"))
        nome_emitente = get_text(emit, "xNome")
        crt = get_text(emit, "CRT")
        ender_emit = find_elem(emit, "enderEmit")
        uf_emitente = get_text(ender_emit, "UF").upper() if ender_emit is not None else ""
        if not uf_emitente:
            uf_emitente = IBGE_UF_MAP.get(get_text(ide, "cUF"), "")
        if not uf_emitente and len(chave_acesso) >= 2:
            uf_emitente = IBGE_UF_MAP.get(chave_acesso[:2], "")
        if not uf_emitente:
            uf_emitente = uf_inicio

        v_prest = find_elem(inf_cte, "vPrest")
        v_total_cte = get_decimal(v_prest, "vTPrest")
        if v_total_cte <= Decimal("0.00"):
            v_total_cte = get_decimal(v_prest, "vRec")

        v_bc_cte, a_ori, a_ori_destacada, v_icms_cte, is_simples = self._extract_icms(inf_cte, crt)
        chaves_nfe = self._extract_chaves_nfe(inf_cte)

        return ExtractedCTeData(
            chave_acesso=chave_acesso,
            numero_cte=numero_cte,
            serie=serie,
            cfop=cfop,
            cnpj_emitente=cnpj_emitente,
            nome_emitente=nome_emitente,
            uf_emitente=uf_emitente,
            uf_inicio=uf_inicio,
            uf_fim=uf_fim,
            cnpj_tomador=cnpj_tomador,
            toma_codigo=toma_codigo,
            data_emissao=data_emissao,
            v_total_cte=v_total_cte,
            v_bc_cte=v_bc_cte,
            a_ori=a_ori,
            a_ori_destacada=a_ori_destacada,
            v_icms_cte=v_icms_cte,
            fornecedor_simples_nacional=is_simples,
            chaves_nfe=chaves_nfe,
            raw_metadata={
                "crt": crt,
                "emit_nome": nome_emitente,
                "toma_codigo": toma_codigo,
                "qtd_nfes_vinculadas": len(chaves_nfe),
            },
        )
