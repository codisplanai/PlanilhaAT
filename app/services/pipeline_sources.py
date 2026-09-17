"""Carregamento, reconciliação e deduplicação das fontes fiscais do pipeline."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from app.core.exceptions import ValidationException
from app.models.empresa import Empresa
from app.models.solicitacao import Solicitacao
from app.services.extraction.base import BaseNFEExtractor, ExtractedNFData
from app.services.extraction.data_entrada_matcher import (
    PlanilhaEntradaParser,
    PlanilhaEntradaRecord,
)
from app.services.extraction.sped_fiscal_extractor import SpedFiscalExtractor
from app.services.pipeline_helpers import crossing_keys, enrich_sped_with_xml


@dataclass
class PipelineSources:
    notes: List[Tuple[str, ExtractedNFData]]
    entry_records: List[PlanilhaEntradaRecord] = field(default_factory=list)
    ignored_notes: List[Dict[str, Any]] = field(default_factory=list)
    sped_company_info: Dict[str, str] = field(default_factory=dict)


class PipelineSourceLoader:
    def __init__(
        self,
        xml_extractor: BaseNFEExtractor,
        sped_extractor: SpedFiscalExtractor,
    ):
        self.xml_extractor = xml_extractor
        self.sped_extractor = sped_extractor

    def load(
        self,
        *,
        solicitacao: Solicitacao,
        empresa: Empresa,
        xml_files: Optional[List[Tuple[str, bytes]]],
        sped_content: Optional[bytes],
        sped_filename: Optional[str],
        entry_sheet_content: Optional[bytes],
        entry_sheet_filename: Optional[str],
    ) -> PipelineSources:
        sped_company_info = self._validate_sped_period(
            solicitacao,
            empresa,
            sped_content,
        )
        entry_records = self._parse_entry_sheet(
            entry_sheet_content,
            entry_sheet_filename,
        )
        notes, ignored_notes = self._extract_notes(
            xml_files,
            sped_content,
            sped_filename,
        )
        if not notes:
            raise ValidationException(
                "Nenhum arquivo XML de NF-e ou SPED Fiscal válido foi encontrado "
                "para processamento."
            )
        return PipelineSources(
            notes=self._deduplicate(notes),
            entry_records=entry_records,
            ignored_notes=ignored_notes,
            sped_company_info=sped_company_info,
        )

    def _validate_sped_period(
        self,
        solicitacao: Solicitacao,
        empresa: Empresa,
        sped_content: Optional[bytes],
    ) -> Dict[str, str]:
        if not sped_content:
            return {}

        company_info = self.sped_extractor.extract_empresa_info(sped_content)
        if not empresa.inscricao_estadual and company_info.get("ie"):
            empresa.inscricao_estadual = company_info["ie"]

        start, end = self.sped_extractor.extract_periodo(sped_content)
        if start and end:
            no_intersection = (
                end < solicitacao.periodo_inicio
                or start > solicitacao.periodo_fim
            )
            if no_intersection:
                raise ValidationException(
                    f"O arquivo SPED enviado refere-se ao período de "
                    f"{start.strftime('%d/%m/%Y')} a {end.strftime('%d/%m/%Y')}, "
                    f"que não coincide com o período da solicitação "
                    f"({solicitacao.periodo_inicio.strftime('%d/%m/%Y')} a "
                    f"{solicitacao.periodo_fim.strftime('%d/%m/%Y')}). "
                    f"Envie o SPED Fiscal da mesma competência que está sendo apurada."
                )
        return company_info

    @staticmethod
    def _parse_entry_sheet(
        content: Optional[bytes],
        filename: Optional[str],
    ) -> List[PlanilhaEntradaRecord]:
        if not content:
            return []
        return PlanilhaEntradaParser.parse(
            file_bytes=content,
            filename=filename or "planilha_entradas.xlsx",
        )

    def _extract_notes(
        self,
        xml_files: Optional[List[Tuple[str, bytes]]],
        sped_content: Optional[bytes],
        sped_filename: Optional[str],
    ) -> Tuple[List[Tuple[str, ExtractedNFData]], List[Dict[str, Any]]]:
        notes: List[Tuple[str, ExtractedNFData]] = []
        ignored_notes: List[Dict[str, Any]] = []
        sped_notes: List[ExtractedNFData] = []

        if sped_content:
            sped_notes = self.sped_extractor.extract_from_sped(sped_content)
            notes.extend(
                (sped_filename or "sped_fiscal.txt", note)
                for note in sped_notes
            )

        sped_by_key = {
            key: note
            for note in sped_notes
            for key in crossing_keys(note)
        }
        for filename, xml_content in xml_files or []:
            try:
                xml_note = self.xml_extractor.extract_from_xml(xml_content)
            except ValidationException as exc:
                if "<infNFe>" not in str(exc):
                    ignored_notes.append(
                        {
                            "numero_nota": "Não identificado",
                            "serie": None,
                            "chave_acesso": None,
                            "data_emissao": None,
                            "motivo": str(exc),
                            "arquivo": filename,
                        }
                    )
                continue

            sped_match = next(
                (
                    sped_by_key[key]
                    for key in crossing_keys(xml_note)
                    if key in sped_by_key
                ),
                None,
            )
            if sped_match is not None:
                enrich_sped_with_xml(sped_match, xml_note)
            else:
                notes.append((filename, xml_note))

        return notes, ignored_notes

    @staticmethod
    def _deduplicate(
        notes: List[Tuple[str, ExtractedNFData]],
    ) -> List[Tuple[str, ExtractedNFData]]:
        unique_notes: List[Tuple[str, ExtractedNFData]] = []
        seen: set[str] = set()
        for source_name, note in notes:
            keys = crossing_keys(note)
            identity = (
                "||".join(keys)
                if keys
                else f"{note.numero_nota}|{note.serie}|{note.cnpj_emitente}"
            )
            if identity in seen:
                continue
            seen.add(identity)
            unique_notes.append((source_name, note))
        return unique_notes
