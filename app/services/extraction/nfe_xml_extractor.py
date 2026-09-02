import xml.etree.ElementTree as ET
from datetime import datetime
from decimal import Decimal
from typing import Optional, Tuple
import re

from app.core.exceptions import ValidationException
from app.services.extraction.base import BaseNFEExtractor, ExtractedNFData, ExtractedItemNF, IBGE_UF_MAP

class NFeXMLExtractor(BaseNFEExtractor):
    """
    Extrator determinístico de dados de NF-e a partir do XML.
    Não utiliza IA/LLM, processa a estrutura oficial da SEFAZ (Schema NF-e v4.00 / v3.10).
    """

    def _strip_tag(self, tag: str) -> str:
        """Remove namespace da tag XML"""
        if "}" in tag:
            return tag.split("}", 1)[1]
        return tag

    def _find_elem(self, parent: Optional[ET.Element], name: str) -> Optional[ET.Element]:
        """Busca elemento filho ignorando namespace"""
        if parent is None:
            return None
        for child in parent:
            if self._strip_tag(child.tag) == name:
                return child
        return None

    def _get_text(self, parent: Optional[ET.Element], name: str, default: str = "") -> str:
        elem = self._find_elem(parent, name)
        if elem is not None and elem.text is not None:
            return elem.text.strip()
        return default

    def _get_decimal(self, parent: Optional[ET.Element], name: str, default: str = "0.00") -> Decimal:
        txt = self._get_text(parent, name, default)
        try:
            return Decimal(txt)
        except Exception:
            return Decimal(default)

    def _parse_datetime(self, date_str: str) -> datetime:
        """Parse de dhEmi (ISO com fuso) ou dEmi (YYYY-MM-DD)"""
        if not date_str:
            raise ValidationException("O XML da NF-e não informa a data de emissão obrigatória.")
        try:
            # dhEmi ex: 2026-01-15T14:30:00-03:00 ou 2026-01-15T14:30:00Z
            # Limpar fuso horário se necessário para datetime nativo
            clean_str = date_str.replace("Z", "")
            if "+" in clean_str:
                clean_str = clean_str.split("+")[0]
            elif "-" in clean_str and clean_str.count("-") > 2:
                # Caso com timezone negativo ex: 2026-01-15T14:30:00-03:00
                parts = clean_str.rsplit("-", 1)
                clean_str = parts[0]
            
            if "T" in clean_str:
                return datetime.fromisoformat(clean_str)
            else:
                return datetime.strptime(clean_str, "%Y-%m-%d")
        except (TypeError, ValueError):
            try:
                return datetime.strptime(date_str[:10], "%Y-%m-%d")
            except (TypeError, ValueError) as exc:
                raise ValidationException(f"Data de emissão inválida no XML: '{date_str}'.") from exc

    def extract_from_xml(self, xml_content: bytes) -> ExtractedNFData:
        try:
            root = ET.fromstring(xml_content)
        except Exception as e:
            raise ValidationException(f"Arquivo XML de NF-e inválido ou corrompido: {str(e)}")

        # Localizar infNFe (pode estar dentro de NFe ou nfeProc)
        inf_nfe = None
        for elem in root.iter():
            if self._strip_tag(elem.tag) == "infNFe":
                inf_nfe = elem
                break

        if inf_nfe is None:
            raise ValidationException("Estrutura do XML não contém a tag obrigatória <infNFe>.")

        # Chave de Acesso
        raw_id = inf_nfe.attrib.get("Id", "")
        chave_acesso = re.sub(r"\D", "", raw_id)

        # Dados de Identificação (<ide>)
        ide = self._find_elem(inf_nfe, "ide")
        numero_nota = self._get_text(ide, "nNF")
        serie = self._get_text(ide, "serie")
        data_str = self._get_text(ide, "dhEmi") or self._get_text(ide, "dEmi")
        data_emissao = self._parse_datetime(data_str)

        data_sai_ent_str = self._get_text(ide, "dhSaiEnt") or self._get_text(ide, "dSaiEnt")
        data_entrada = None
        if data_sai_ent_str:
            try:
                data_entrada = self._parse_datetime(data_sai_ent_str).date()
            except Exception:
                data_entrada = None

        # Emitente (<emit>)
        emit = self._find_elem(inf_nfe, "emit")
        cnpj_emitente = self._get_text(emit, "CNPJ") or self._get_text(emit, "CPF")
        cnpj_emitente = re.sub(r"\D", "", cnpj_emitente)
        crt_emitente = self._get_text(emit, "CRT")

        ender_emit = self._find_elem(emit, "enderEmit")
        uf_emitente = self._get_text(ender_emit, "UF").strip().upper() if ender_emit is not None else ""

        # Fallback 1: tag <ide><cUF>
        if not uf_emitente:
            c_uf = self._get_text(ide, "cUF")
            if c_uf in IBGE_UF_MAP:
                uf_emitente = IBGE_UF_MAP[c_uf]

        # Fallback 2: Primeiros 2 dígitos da Chave de Acesso (cUF)
        if not uf_emitente and len(chave_acesso) >= 2:
            c_uf = chave_acesso[:2]
            if c_uf in IBGE_UF_MAP:
                uf_emitente = IBGE_UF_MAP[c_uf]

        # Destinatário (<dest>)
        dest = self._find_elem(inf_nfe, "dest")
        cnpj_destinatario = self._get_text(dest, "CNPJ") or self._get_text(dest, "CPF")
        cnpj_destinatario = re.sub(r"\D", "", cnpj_destinatario)

        ender_dest = self._find_elem(dest, "enderDest")
        uf_destinatario = self._get_text(ender_dest, "UF").strip().upper() if ender_dest is not None else ""

        # Totais da Nota (<total>/<ICMSTot>)
        total_elem = self._find_elem(inf_nfe, "total")
        icms_tot = self._find_elem(total_elem, "ICMSTot") if total_elem is not None else None
        v_total_nota = self._get_decimal(icms_tot, "vNF")
        v_bc_nota = self._get_decimal(icms_tot, "vBC")

        # Itens da Nota (<det>)
        itens: list[ExtractedItemNF] = []
        for det in inf_nfe:
            if self._strip_tag(det.tag) != "det":
                continue

            item_num_str = det.attrib.get("nItem", str(len(itens) + 1))
            try:
                item_numero = int(item_num_str)
            except ValueError:
                item_numero = len(itens) + 1

            prod = self._find_elem(det, "prod")
            ncm = self._get_text(prod, "NCM")
            cest = self._get_text(prod, "CEST")
            cfop = self._get_text(prod, "CFOP")
            x_prod = self._get_text(prod, "xProd")
            v_prod = self._get_decimal(prod, "vProd")
            v_frete = self._get_decimal(prod, "vFrete")
            v_seg = self._get_decimal(prod, "vSeg")
            v_outro = self._get_decimal(prod, "vOutro")
            v_desc = self._get_decimal(prod, "vDesc")

            # Impostos (<imposto>)
            imposto = self._find_elem(det, "imposto")
            
            # IPI do item
            v_ipi = Decimal("0.00")
            ipi_elem = self._find_elem(imposto, "IPI")
            if ipi_elem is not None:
                for child in ipi_elem:
                    if self._strip_tag(child.tag) in ["IPITrib", "IPINT"]:
                        v_ipi = self._get_decimal(child, "vIPI")
                        break

            # ICMS do item -> extrai Base de Cálculo (vBC) e Alíquota de Origem (A.ORI / pICMS)
            v_bc_item = Decimal("0.00")
            p_icms_item = Decimal("0.00")
            icms_elem = self._find_elem(imposto, "ICMS")
            
            if icms_elem is not None:
                for icms_group in icms_elem:
                    # Pode ser ICMS00, ICMS10, ICMS20, ICMS70, ICMS90, ICMSSN101, etc.
                    # Base de cálculo
                    bc_val = self._get_decimal(icms_group, "vBC")
                    if bc_val > 0:
                        v_bc_item = bc_val

                    # Alíquota de Origem (pICMS ou pCredSN para simples nacional)
                    p_val = self._get_decimal(icms_group, "pICMS")
                    if p_val == 0:
                        p_val = self._get_decimal(icms_group, "pCredSN")
                    
                    if p_val > 0:
                        p_icms_item = p_val
                    break

            # A.ORI em decimal (ex: 12.00% -> 0.1200)
            a_ori = p_icms_item / Decimal("100.0") if p_icms_item > 1 else p_icms_item

            # IPI + Despesas do item
            ipi_despesas = v_ipi + v_frete + v_seg + v_outro

            # Valor Total do Item (V.Total daquele item)
            # V.Total = vProd + vFrete + vSeg + vOutro + vIPI - vDesc
            v_total_item = v_prod + ipi_despesas - v_desc

            # A base total da capa nunca pode ser atribuída arbitrariamente a um
            # dos itens de uma NF-e com múltiplos produtos.
            if v_bc_item == Decimal("0.00"):
                v_bc_item = v_total_item - ipi_despesas

            itens.append(ExtractedItemNF(
                item_numero=item_numero,
                ncm=re.sub(r"\D", "", ncm),
                cest=re.sub(r"\D", "", cest),
                cfop=cfop,
                descricao=x_prod,
                v_item=v_prod,
                v_total=v_total_item,
                base_calculo=v_bc_item,
                ipi_despesas=ipi_despesas,
                a_ori=a_ori
            ))

        # Se houver discrepância e houver apenas 1 item, ajustar v_total_item com v_total_nota
        if len(itens) == 1 and v_total_nota > 0:
            itens[0].v_total = v_total_nota
            if v_bc_nota > 0:
                itens[0].base_calculo = v_bc_nota
            elif itens[0].base_calculo <= 0:
                itens[0].base_calculo = v_total_nota - itens[0].ipi_despesas

        return ExtractedNFData(
            chave_acesso=chave_acesso,
            numero_nota=numero_nota,
            serie=serie,
            cnpj_emitente=cnpj_emitente,
            uf_emitente=uf_emitente,
            cnpj_destinatario=cnpj_destinatario,
            uf_destinatario=uf_destinatario,
            data_emissao=data_emissao,
            data_entrada=data_entrada,
            v_total_nota=v_total_nota,
            v_bc_nota=v_bc_nota,
            itens=itens,
            raw_metadata={"qtd_itens": len(itens), "crt": crt_emitente}
        )
