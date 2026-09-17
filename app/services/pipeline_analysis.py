"""Pré-análise das fontes antes do processamento fiscal definitivo."""

import re
from decimal import Decimal
from typing import Any, Dict, List, Tuple

from app.models.empresa import Empresa
from app.models.solicitacao import Solicitacao
from app.services.extraction.base import ExtractedNFData
from app.services.validation.sanity_checker import SanityChecker


CFOP_SUFFIXES_REQUIRING_DESTINATION = frozenset({"910", "911", "949"})


class PipelinePreAnalyzer:
    @classmethod
    def analyze(
        cls,
        notes: List[Tuple[str, ExtractedNFData]],
        empresa: Empresa,
        solicitacao: Solicitacao,
    ) -> Dict[str, Any]:
        eligible_notes = cls._eligible_notes(notes, empresa, solicitacao)
        pending = cls.detect_destination_decisions(eligible_notes)
        return {
            "requer_decisao": bool(pending),
            "notas_bonificacao": pending,
        }

    @staticmethod
    def _eligible_notes(
        notes: List[Tuple[str, ExtractedNFData]],
        empresa: Empresa,
        solicitacao: Solicitacao,
    ) -> List[Tuple[str, ExtractedNFData]]:
        company_state = (empresa.uf or "").strip().upper()
        return [
            (filename, note)
            for filename, note in notes
            if (not note.uf_emitente or note.uf_emitente.strip().upper() != company_state)
            and SanityChecker.is_within_period(
                note.data_emissao,
                solicitacao.periodo_inicio,
                solicitacao.periodo_fim,
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
