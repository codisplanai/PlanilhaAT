"""Pré-análise das fontes antes do processamento fiscal definitivo."""

import re
from decimal import Decimal
from typing import Any, Dict, List, Optional, Set, Tuple

from app.models.empresa import Empresa
from app.models.solicitacao import Solicitacao
from app.services.extraction.base import (
    ExtractedCTeData,
    ExtractedNFData,
    extrair_numero_serie_chave_nfe,
)
from app.services.rules_engine.supplier_usage import supplier_usage_mode, supplier_usage_pending
from app.services.pipeline_helpers import aceita_difal_retroativa, is_emissao_propria
from app.services.validation.sanity_checker import SanityChecker


CFOP_SUFFIXES_REQUIRING_DESTINATION = frozenset({"910", "911", "949"})


def _nfe_disponivel_para_cte(note: ExtractedNFData) -> bool:
    chave = re.sub(r"\D", "", note.chave_acesso or "")
    if len(chave) != 44:
        return False
    if note.origem_extracao == "xml":
        return True
    return len(note.itens) > 0 and any(bool((it.cfop or "").strip()) for it in note.itens)


def validate_note_destinatario(
    nf_data: ExtractedNFData,
    empresa: Empresa,
    solicitacao: Solicitacao,
    is_referenced_by_cte: bool,
) -> None:
    """Valida CNPJ destinatário da NF-e, preservando exceção de CT-e fora do período."""
    dentro_do_periodo = SanityChecker.is_within_period(
        nf_data.data_emissao, solicitacao.periodo_inicio, solicitacao.periodo_fim
    )
    if not (is_referenced_by_cte and not dentro_do_periodo):
        SanityChecker.validate_nf_destinatario(nf_data, empresa.cnpj)


def validate_notes_destinatario(
    notes: List[Tuple[str, ExtractedNFData]],
    empresa: Empresa,
    solicitacao: Solicitacao,
    referenced_chaves: Set[str],
) -> None:
    """Impede que NF-e de outro CNPJ chegue às etapas interativas de pré-análise."""
    for _filename, nf_data in notes:
        if is_emissao_propria(nf_data, empresa.cnpj):
            continue
        clean_chave = re.sub(r"\D", "", nf_data.chave_acesso or "")
        is_referenced_by_cte = bool(clean_chave and clean_chave in referenced_chaves)
        validate_note_destinatario(nf_data, empresa, solicitacao, is_referenced_by_cte)


class PipelinePreAnalyzer:
    @classmethod
    def analyze(
        cls,
        notes: List[Tuple[str, ExtractedNFData]],
        empresa: Empresa,
        solicitacao: Solicitacao,
        ctes: Optional[List[Tuple[str, ExtractedCTeData]]] = None,
        decisoes_uso_consumo: Optional[Dict[str, bool]] = None,
    ) -> Dict[str, Any]:
        ctes_list = ctes or []
        referenced_chaves = cls._eligible_cte_nfe_keys(ctes_list, empresa, solicitacao)
        validate_notes_destinatario(notes, empresa, solicitacao, referenced_chaves)
        pending_ctes = cls.detect_missing_cte_nfes(ctes_list, notes, empresa, solicitacao)
        eligible_notes = cls._eligible_notes(notes, empresa, solicitacao, referenced_chaves)
        usage_pending = supplier_usage_pending(eligible_notes, empresa, decisoes_uso_consumo)
        pending = cls.detect_destination_decisions([
            (filename, note) for filename, note in eligible_notes
            if not supplier_usage_mode(note, empresa, decisoes_uso_consumo)
        ])
        return {
            "requer_decisao": bool(pending or pending_ctes or usage_pending),
            "notas_uso_consumo": usage_pending,
            "notas_bonificacao": pending,
            "ctes_sem_nfe": pending_ctes,
        }

    @staticmethod
    def _eligible_cte_nfe_keys(
        ctes: List[Tuple[str, ExtractedCTeData]],
        empresa: Empresa,
        solicitacao: Solicitacao,
    ) -> Set[str]:
        empresa_cnpj = re.sub(r"\D", "", empresa.cnpj or "")
        if not empresa_cnpj:
            return set()
        keys: Set[str] = set()
        for _filename, cte in ctes:
            tomador = re.sub(r"\D", "", cte.cnpj_tomador or "")
            if tomador != empresa_cnpj or not cte.data_emissao:
                continue
            if not SanityChecker.is_interestadual(cte.uf_emitente, empresa.uf):
                continue
            if SanityChecker.is_within_period(
                cte.data_emissao, solicitacao.periodo_inicio, solicitacao.periodo_fim
            ):
                keys.update(cte.chaves_nfe)
        return keys

    @staticmethod
    def detect_missing_cte_nfes(
        ctes: List[Tuple[str, ExtractedCTeData]],
        notes: List[Tuple[str, ExtractedNFData]],
        empresa: Empresa,
        solicitacao: Solicitacao,
    ) -> List[Dict[str, Any]]:
        empresa_cnpj = re.sub(r"\D", "", empresa.cnpj or "")
        if not empresa_cnpj or not ctes:
            return []

        available_chaves = {
            re.sub(r"\D", "", note.chave_acesso or "")
            for _filename, note in notes
            if _nfe_disponivel_para_cte(note)
        }

        pending: List[Dict[str, Any]] = []
        for _filename, cte in ctes:
            tomador = re.sub(r"\D", "", cte.cnpj_tomador or "")
            if tomador != empresa_cnpj or not cte.data_emissao:
                continue
            if not SanityChecker.is_interestadual(cte.uf_emitente, empresa.uf):
                continue
            if not SanityChecker.is_within_period(
                cte.data_emissao, solicitacao.periodo_inicio, solicitacao.periodo_fim
            ):
                continue
            missing = [chv for chv in cte.chaves_nfe if chv not in available_chaves]
            if not missing:
                continue
            nfes_faltantes = []
            for chv in missing:
                numero_nfe, serie_nfe = extrair_numero_serie_chave_nfe(chv)
                nfes_faltantes.append(
                    {
                        "chave_acesso": chv,
                        "numero_nota": numero_nfe,
                        "serie": serie_nfe,
                    }
                )
            pending.append(
                {
                    "cte_chave_acesso": cte.chave_acesso,
                    "cte_numero": cte.numero_cte,
                    "cte_serie": cte.serie or "",
                    "cnpj_emitente": cte.cnpj_emitente or "",
                    "nome_emitente": cte.nome_emitente or "",
                    "valor_total": cte.v_total_cte,
                    "nfes_faltantes": nfes_faltantes,
                }
            )
        return pending

    @staticmethod
    def _eligible_notes(
        notes: List[Tuple[str, ExtractedNFData]],
        empresa: Empresa,
        solicitacao: Solicitacao,
        referenced_chaves: Optional[Set[str]] = None,
    ) -> List[Tuple[str, ExtractedNFData]]:
        ref_set = referenced_chaves or set()
        return [
            (filename, note)
            for filename, note in notes
            if not is_emissao_propria(note, empresa.cnpj)
            and SanityChecker.is_interestadual(note.uf_emitente, empresa.uf)
            and (
                SanityChecker.is_within_period(
                    note.data_emissao,
                    solicitacao.periodo_inicio,
                    solicitacao.periodo_fim,
                )
                # Regime Normal: bonificação emitida antes do período e escriturada no
                # SPED do período pode ser uso/consumo apurado na DIFAL da entrada.
                or aceita_difal_retroativa(
                    note, bool(empresa.optante_simples_nacional), solicitacao.periodo_inicio
                )
                or re.sub(r"\D", "", note.chave_acesso or "") in ref_set
            )
        ]

    @staticmethod
    def detect_destination_decisions(
        notes: List[Tuple[str, ExtractedNFData]],
    ) -> List[Dict[str, Any]]:
        pending: List[Dict[str, Any]] = []
        for _filename, note in notes:
            bonus_items = [
                item
                for item in note.itens
                if re.sub(r"\D", "", item.cfop or "")[-3:]
                in CFOP_SUFFIXES_REQUIRING_DESTINATION
            ]
            if not bonus_items:
                continue

            cfops = sorted({item.cfop for item in bonus_items if item.cfop})
            total = sum((item.v_total for item in bonus_items), Decimal("0.00"))
            has_credit = note.v_icms_nota > Decimal("0.00") or any(
                item.v_icms > Decimal("0.00")
                or (item.base_calculo > Decimal("0.00") and item.a_ori > Decimal("0.00"))
                for item in bonus_items
            )
            pending.append(
                {
                    "chave_acesso": note.chave_acesso,
                    "numero_nota": note.numero_nota,
                    "serie": note.serie or "",
                    "cnpj_emitente": note.cnpj_emitente or "",
                    "nome_emitente": note.raw_metadata.get("emit_nome") or "",
                    "cfops": cfops,
                    "valor_total": total,
                    "tem_credito": has_credit,
                    "sugestao_revenda": has_credit,
                    "motivo_sugestao": PipelinePreAnalyzer._credit_reason(note, has_credit),
                }
            )
        return pending

    @staticmethod
    def _credit_reason(note: ExtractedNFData, has_credit: bool) -> str:
        is_sped = note.origem_extracao == "sped"
        if is_sped:
            if has_credit and note.v_icms_nota > 0:
                return f"Crédito de ICMS de R$ {note.v_icms_nota:.2f} identificado no SPED Fiscal"
            return (
                "Destaque de crédito de ICMS identificado no item do SPED Fiscal"
                if has_credit
                else "Sem destaque de crédito no SPED Fiscal"
            )
        if has_credit and note.v_icms_nota > 0:
            return f"Destaque de ICMS próprio de R$ {note.v_icms_nota:.2f} no XML da NF-e"
        return (
            "Destaque de ICMS próprio identificado no item do XML da NF-e"
            if has_credit
            else "Sem destaque de ICMS próprio no XML da NF-e"
        )
