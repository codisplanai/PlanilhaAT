import re
from datetime import datetime, date
from decimal import Decimal
from typing import List, Dict, Any, Optional, Tuple

from app.core.exceptions import ValidationException
from app.services.extraction.base import ExtractedNFData, ExtractedItemNF, IBGE_UF_MAP

class SpedFiscalExtractor:
    """
    Extrator determinístico de dados de notas fiscais a partir de arquivos do SPED Fiscal (EFD ICMS/IPI .txt).
    Processa registros 0000, 0150, 0200, C100, C170 e C190 (fallback).
    """

    @staticmethod
    def _decode_content(content: bytes) -> str:
        """Tenta decodificar o arquivo SPED utilizando encodings usuais no Brasil"""
        for enc in ["utf-8", "iso-8859-1", "latin1", "cp1252", "windows-1252"]:
            try:
                return content.decode(enc)
            except UnicodeDecodeError:
                continue
        return content.decode("latin1", errors="ignore")

    @staticmethod
    def _parse_sped_date(date_str: str) -> Optional[date]:
        """Converte data no formato DDMMAAAA do SPED para objeto date"""
        clean = re.sub(r"\D", "", date_str.strip())
        if len(clean) != 8:
            return None
        try:
            day = int(clean[0:2])
            month = int(clean[2:4])
            year = int(clean[4:8])
            return date(year, month, day)
        except Exception:
            return None

    @staticmethod
    def _parse_sped_decimal(val_str: str, default: str = "0.00") -> Decimal:
        """Converte valor numérico do SPED (ex: '1250,50' ou '1250.50') para Decimal"""
        if not val_str:
            return Decimal(default)
        clean = val_str.strip().replace(".", "").replace(",", ".") if "," in val_str else val_str.strip()
        try:
            return Decimal(clean)
        except Exception:
            return Decimal(default)

    @staticmethod
    def extract_periodo(sped_content: bytes) -> Tuple[Optional[date], Optional[date]]:
        """
        Lê o período de escrituração declarado no registro 0000 (campo 4 = DT_INI,
        campo 5 = DT_FIN) sem processar o arquivo inteiro.

        Devolve (date, date) ou (None, None) se o registro 0000 não existir ou as
        datas forem inválidas.
        """
        text = SpedFiscalExtractor._decode_content(sped_content)
        for line in text.splitlines():
            line_str = line.strip()
            if not line_str.startswith("|"):
                continue
            fields = line_str.split("|")
            if len(fields) > 5 and fields[1].strip().upper() == "0000":
                dt_ini = SpedFiscalExtractor._parse_sped_date(fields[4])
                dt_fim = SpedFiscalExtractor._parse_sped_date(fields[5])
                return dt_ini, dt_fim
        return None, None

    @staticmethod
    def extract_empresa_info(sped_content: bytes) -> Dict[str, str]:
        """
        Extrai os dados cadastrais da empresa declarante a partir do Registro 0000 do SPED Fiscal:
        - razao_social (Campo 6: NOME)
        - cnpj (Campo 7: CNPJ ou Campo 8: CPF)
        - uf (Campo 9: UF)
        - ie (Campo 10: IE)
        """
        text = SpedFiscalExtractor._decode_content(sped_content)
        info = {"razao_social": "", "cnpj": "", "uf": "", "ie": ""}
        for line in text.splitlines():
            line_str = line.strip()
            if not line_str.startswith("|"):
                continue
            fields = line_str.split("|")
            if len(fields) > 5 and fields[1].strip().upper() == "0000":
                info["razao_social"] = fields[6].strip() if len(fields) > 6 else ""
                cnpj_raw = fields[7] if len(fields) > 7 and fields[7] else (fields[8] if len(fields) > 8 else "")
                info["cnpj"] = re.sub(r"\D", "", cnpj_raw)
                uf_raw = fields[9].strip().upper() if len(fields) > 9 else ""
                info["uf"] = IBGE_UF_MAP.get(uf_raw, uf_raw)
                info["ie"] = fields[10].strip() if len(fields) > 10 else ""
                return info
        return info

    def extract_from_sped(self, sped_content: bytes) -> List[ExtractedNFData]:
        text = self._decode_content(sped_content)
        lines = text.splitlines()

        if not lines:
            raise ValidationException("O arquivo SPED Fiscal fornecido está vazio.")

        dest_cnpj = ""
        dest_uf = ""
        dest_ie = ""
        dest_nome = ""
        participantes: Dict[str, Dict[str, str]] = {}   # COD_PART -> {"cnpj": ..., "nome": ..., "uf": ...}
        itens_cadastrados: Dict[str, Dict[str, str]] = {} # COD_ITEM -> {"ncm": ..., "descricao": ...}

        notas_extraidas: List[ExtractedNFData] = []
        current_c100: Optional[Dict[str, Any]] = None
        current_itens: List[ExtractedItemNF] = []
        current_c190: List[Dict[str, Any]] = []

        def _finalizar_c100():
            nonlocal current_c100, current_itens, current_c190
            if not current_c100:
                return

            # Se não houve C170, mas houve C190 (analítico), constrói itens sintéticos a partir do C190
            if not current_itens and current_c190:
                for idx, c190 in enumerate(current_c190, start=1):
                    a_ori_raw = c190["a_ori"]
                    a_ori = a_ori_raw / Decimal("100.0") if a_ori_raw > 1 else a_ori_raw
                    current_itens.append(ExtractedItemNF(
                        item_numero=idx,
                        ncm=c190.get("ncm", "00000000"),
                        cfop=c190.get("cfop", ""),
                        descricao=f"Item Analítico C190 #{idx} (CFOP {c190.get('cfop', '')})",
                        descricao_confiavel=False,
                        v_item=c190["v_opr"],
                        v_total=c190["v_opr"] + c190["v_ipi"],
                        base_calculo=c190["base_calculo"],
                        ipi_despesas=c190["v_ipi"],
                        a_ori=a_ori,
                        v_icms=c190.get("v_icms", Decimal("0.00"))
                    ))

            # Se ainda assim não houver itens, gera 1 item consolidado da capa C100
            if not current_itens:
                current_itens.append(ExtractedItemNF(
                    item_numero=1,
                    ncm="00000000",
                    cfop="",
                    descricao=f"NF-e {current_c100['numero_nota']} (Consolidado SPED)",
                    descricao_confiavel=False,
                    v_item=current_c100["v_total_nota"],
                    v_total=current_c100["v_total_nota"],
                    base_calculo=current_c100["v_bc_nota"],
                    ipi_despesas=current_c100["v_ipi_nota"] + current_c100["v_despesas_nota"],
                    a_ori=Decimal("0.00"),
                    v_icms=current_c100["v_icms_nota"]
                ))

            # Resolver CNPJ e UF do emitente a partir do cadastro 0150
            cod_part = current_c100.get("cod_part", "")
            part_info = participantes.get(cod_part, {})
            cnpj_emitente = part_info.get("cnpj", "")
            nome_emitente = part_info.get("nome", "")
            uf_emitente = part_info.get("uf", "")

            # Fallback para UF Emitente: primeiros 2 dígitos da Chave de Acesso
            chv = current_c100.get("chave_acesso", "")
            if not uf_emitente and len(chv) >= 2 and chv[:2] in IBGE_UF_MAP:
                uf_emitente = IBGE_UF_MAP[chv[:2]]

            dt_emissao = current_c100["data_emissao"]
            dt_emissao_dt = datetime.combine(dt_emissao, datetime.min.time()) if isinstance(dt_emissao, date) else dt_emissao

            nf_data = ExtractedNFData(
                chave_acesso=current_c100["chave_acesso"],
                numero_nota=current_c100["numero_nota"],
                serie=current_c100["serie"],
                cnpj_emitente=cnpj_emitente,
                uf_emitente=uf_emitente,
                cnpj_destinatario=dest_cnpj,
                uf_destinatario=dest_uf,
                data_emissao=dt_emissao_dt,
                data_entrada=current_c100.get("data_entrada"),
                v_total_nota=current_c100["v_total_nota"],
                v_bc_nota=current_c100["v_bc_nota"],
                v_icms_nota=current_c100["v_icms_nota"],
                itens=current_itens,
                raw_metadata={
                    "origem": "sped_fiscal",
                    "cod_part": cod_part,
                    "qtd_itens": len(current_itens),
                    "dest_ie": dest_ie,
                    "dest_nome": dest_nome,
                    "emit_nome": nome_emitente
                },
                origem_extracao="sped"
            )
            notas_extraidas.append(nf_data)

            current_c100 = None
            current_itens = []
            current_c190 = []

        for line in lines:
            line_str = line.strip()
            if not line_str or not line_str.startswith("|"):
                continue

            fields = line_str.split("|")
            if len(fields) < 3:
                continue

            reg = fields[1].upper()

            # 1. Registro 0000: Dados da Empresa Destinatária (Declarante)
            if reg == "0000":
                dest_nome = fields[6].strip() if len(fields) > 6 else ""
                # Campo 7: CNPJ, Campo 8: CPF, Campo 9: UF, Campo 10: IE
                cnpj_raw = fields[7] if len(fields) > 7 and fields[7] else (fields[8] if len(fields) > 8 else "")
                dest_cnpj = re.sub(r"\D", "", cnpj_raw)
                uf_raw = fields[9].strip().upper() if len(fields) > 9 else ""
                dest_uf = IBGE_UF_MAP.get(uf_raw, uf_raw)
                dest_ie = fields[10].strip() if len(fields) > 10 else ""

            # 2. Registro 0150: Cadastro de Participantes / Fornecedores
            elif reg == "0150":
                # Campo 2: COD_PART, Campo 3: NOME, Campo 5: CNPJ, Campo 6: CPF, Campo 8: COD_MUN
                if len(fields) > 5:
                    cod_part = fields[2].strip()
                    nome = fields[3].strip() if len(fields) > 3 else ""
                    cnpj_part = fields[5].strip() if len(fields) > 5 and fields[5].strip() else (fields[6].strip() if len(fields) > 6 else "")
                    
                    # UF do participante: extrair do COD_MUN (código IBGE) ou de campos adicionais
                    uf_part = ""
                    if len(fields) > 8 and fields[8].strip():
                        cod_mun = re.sub(r"\D", "", fields[8].strip())
                        if len(cod_mun) >= 2 and cod_mun[:2] in IBGE_UF_MAP:
                            uf_part = IBGE_UF_MAP[cod_mun[:2]]
                    
                    if not uf_part and len(fields) > 7 and len(fields[7].strip()) == 2 and fields[7].strip().isalpha():
                        uf_part = fields[7].strip().upper()

                    participantes[cod_part] = {
                        "cnpj": re.sub(r"\D", "", cnpj_part),
                        "nome": nome,
                        "uf": uf_part
                    }

            # 3. Registro 0200: Cadastro de Itens e NCM
            elif reg == "0200":
                # Campo 2: COD_ITEM, Campo 3: DESCR_ITEM, Campo 8: COD_NCM
                if len(fields) > 8:
                    cod_item = fields[2].strip()
                    descr = fields[3].strip() if len(fields) > 3 else ""
                    ncm_raw = fields[8].strip() if len(fields) > 8 else ""
                    ncm_clean = re.sub(r"\D", "", ncm_raw)
                    itens_cadastrados[cod_item] = {
                        "ncm": ncm_clean,
                        "cest": re.sub(r"\D", "", fields[13]) if len(fields) > 13 else "",
                        "descricao": descr
                    }

            # 4. Registro C100: Capa da Nota Fiscal
            elif reg == "C100":
                _finalizar_c100()

                # Validação de filtros de entrada:
                # Campo 2: IND_OPER (0 = Entrada, 1 = Saída)
                ind_oper = fields[2].strip() if len(fields) > 2 else "0"
                if ind_oper != "0":
                    # Pular notas de saída
                    continue

                # Campo 6: COD_SIT (00 = Regular, 01 = Extemporâneo)
                cod_sit = fields[6].strip() if len(fields) > 6 else "00"
                if cod_sit not in ["00", "01"]:
                    # Pular notas canceladas / inutilizadas / denegadas
                    continue

                cod_part = fields[4].strip() if len(fields) > 4 else ""
                serie = fields[7].strip() if len(fields) > 7 else "1"
                num_doc = fields[8].strip() if len(fields) > 8 else ""
                chv_nfe = fields[9].strip() if len(fields) > 9 else ""
                chv_nfe = re.sub(r"\D", "", chv_nfe)

                # Datas: Campo 10 (DT_DOC = Emissão), Campo 11 (DT_E_S = Entrada)
                dt_doc_raw = fields[10] if len(fields) > 10 else ""
                dt_es_raw = fields[11] if len(fields) > 11 else ""

                data_emissao = self._parse_sped_date(dt_doc_raw)
                if data_emissao is None:
                    raise ValidationException(
                        f"O documento SPED nº '{num_doc or '(sem número)'}' possui data de emissão inválida."
                    )
                data_entrada = self._parse_sped_date(dt_es_raw)

                vl_doc = self._parse_sped_decimal(fields[12] if len(fields) > 12 else "0.00")
                vl_desc = self._parse_sped_decimal(fields[14] if len(fields) > 14 else "0.00")
                vl_frt = self._parse_sped_decimal(fields[18] if len(fields) > 18 else "0.00")
                vl_seg = self._parse_sped_decimal(fields[19] if len(fields) > 19 else "0.00")
                vl_out = self._parse_sped_decimal(fields[20] if len(fields) > 20 else "0.00")
                vl_bc_icms = self._parse_sped_decimal(fields[21] if len(fields) > 21 else "0.00")
                vl_icms = self._parse_sped_decimal(fields[22] if len(fields) > 22 else "0.00")
                vl_ipi = self._parse_sped_decimal(fields[25] if len(fields) > 25 else "0.00")

                current_c100 = {
                    "cod_part": cod_part,
                    "serie": serie,
                    "numero_nota": num_doc,
                    "chave_acesso": chv_nfe,
                    "data_emissao": data_emissao,
                    "data_entrada": data_entrada,
                    "v_total_nota": vl_doc,
                    "v_bc_nota": vl_bc_icms,
                    "v_icms_nota": vl_icms,
                    "v_ipi_nota": vl_ipi,
                    "v_despesas_nota": vl_frt + vl_seg + vl_out,
                    "v_desc_nota": vl_desc
                }
                current_itens = []
                current_c190 = []

            # 5. Registro C170: Itens da NF-e
            elif reg == "C170" and current_c100 is not None:
                # Campo 2: NUM_ITEM
                num_item_str = fields[2].strip() if len(fields) > 2 else str(len(current_itens) + 1)
                try:
                    num_item = int(num_item_str)
                except ValueError:
                    num_item = len(current_itens) + 1

                # Campo 3: COD_ITEM
                cod_item = fields[3].strip() if len(fields) > 3 else ""
                item_info = itens_cadastrados.get(cod_item, {})
                ncm = item_info.get("ncm", "00000000")
                cest = item_info.get("cest", "")
                descr = item_info.get("descricao", f"Item {cod_item}")

                vl_item = self._parse_sped_decimal(fields[7] if len(fields) > 7 else "0.00")
                vl_desc = self._parse_sped_decimal(fields[8] if len(fields) > 8 else "0.00")
                cfop = fields[11].strip() if len(fields) > 11 else ""
                vl_bc_icms = self._parse_sped_decimal(fields[13] if len(fields) > 13 else "0.00")
                aliq_icms = self._parse_sped_decimal(fields[14] if len(fields) > 14 else "0.00")
                vl_icms = self._parse_sped_decimal(fields[15] if len(fields) > 15 else "0.00")
                vl_ipi = self._parse_sped_decimal(fields[24] if len(fields) > 24 else "0.00")
                vl_bc_pis = self._parse_sped_decimal(fields[26] if len(fields) > 26 else "0.00")

                # Alíquota de origem (ex: 12.00% -> 0.1200)
                a_ori = aliq_icms / Decimal("100.0") if aliq_icms > 1 else aliq_icms

                # Valor total do item considerando IPI e desconto
                v_total_item = vl_item + vl_ipi - vl_desc
                if v_total_item <= 0 and vl_item > 0:
                    v_total_item = vl_item

                # Determinação correta de Base de Cálculo e IPI
                if vl_bc_icms > Decimal("0.00"):
                    bc_item = vl_bc_icms
                    if vl_ipi == Decimal("0.00") and v_total_item > vl_bc_icms:
                        ipi_despesas_item = v_total_item - vl_bc_icms
                    else:
                        ipi_despesas_item = vl_ipi
                elif vl_bc_pis > Decimal("0.00") and vl_bc_pis < v_total_item:
                    bc_item = vl_bc_pis
                    ipi_despesas_item = v_total_item - vl_bc_pis
                else:
                    bc_item = v_total_item - vl_ipi
                    ipi_despesas_item = vl_ipi

                current_itens.append(ExtractedItemNF(
                    item_numero=num_item,
                    ncm=ncm,
                    cest=cest,
                    cfop=cfop,
                    descricao=descr,
                    v_item=vl_item,
                    v_total=v_total_item,
                    base_calculo=bc_item,
                    ipi_despesas=ipi_despesas_item,
                    a_ori=a_ori,
                    v_icms=vl_icms
                ))

            # 6. Registro C190: Registro Analítico (Fallback)
            elif reg == "C190" and current_c100 is not None:
                cfop = fields[3].strip() if len(fields) > 3 else ""
                aliq_icms = self._parse_sped_decimal(fields[4] if len(fields) > 4 else "0.00")
                vl_opr = self._parse_sped_decimal(fields[5] if len(fields) > 5 else "0.00")
                vl_bc_icms = self._parse_sped_decimal(fields[6] if len(fields) > 6 else "0.00")
                vl_icms = self._parse_sped_decimal(fields[7] if len(fields) > 7 else "0.00")
                vl_ipi = self._parse_sped_decimal(fields[11] if len(fields) > 11 else "0.00")
                if vl_bc_icms > Decimal("0.00"):
                    bc_c190 = vl_bc_icms
                    ipi_c190 = (vl_opr - vl_bc_icms) if vl_ipi == Decimal("0.00") and vl_opr > vl_bc_icms else vl_ipi
                else:
                    bc_c190 = vl_opr - vl_ipi
                    ipi_c190 = vl_ipi

                current_c190.append({
                    "cfop": cfop,
                    "a_ori": aliq_icms,
                    "v_opr": vl_opr,
                    "base_calculo": bc_c190,
                    "v_icms": vl_icms,
                    "v_ipi": ipi_c190
                })

        # Finalizar última nota fiscal se houver
        _finalizar_c100()

        if not notas_extraidas:
            raise ValidationException(
                "Nenhum documento fiscal de entrada (Registro C100, IND_OPER=0) válido foi encontrado no arquivo SPED Fiscal."
            )

        return notas_extraidas
