"""Geração, persistência e regeneração das planilhas do pipeline fiscal."""

import os
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Mapping, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.constants import (
    ANTECIPACAO_PARCIAL_ANTECIPADO,
    ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES,
)
from app.core.config import settings
from app.core.exceptions import NotFoundException, ValidationException
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.solicitacao import Solicitacao
from app.models.solicitacao_saida import SolicitacaoSaida
from app.models.template_xlsx import TemplateXlsx
from app.services.excel.template_filler import TemplateFiller
from app.services.local_files import atomic_write, read_bytes_if_exists, remove_file_if_exists
from app.services.pipeline_helpers import build_header_info
from app.services.supabase_storage import SupabaseStorageService
from app.services.templates_admin.template_manager import TemplateManager


@dataclass
class GeneratedArtifacts:
    local_paths: List[str] = field(default_factory=list)
    cloud_names: List[str] = field(default_factory=list)

    def cleanup(self) -> None:
        for path in self.local_paths:
            try:
                remove_file_if_exists(path)
            except OSError:
                pass
        for filename in self.cloud_names:
            SupabaseStorageService.delete_file(
                settings.SUPABASE_STORAGE_BUCKET_OUTPUTS,
                filename,
            )


@dataclass(frozen=True)
class _OutputBackup:
    output_path: str
    local_content: Optional[bytes]
    filename: str
    cloud_content: Optional[bytes]


def processed_note_to_row(note: NotaFiscalProcessada) -> Dict[str, Any]:
    """Converte a entidade persistida no contrato de entrada do TemplateFiller."""
    metadata = note.metadados_extras or {}
    issue_date = note.data_emissao
    if (
        note.destino_planilha in (ANTECIPACAO_PARCIAL_ANTECIPADO, ANTECIPACAO_PARCIAL_ANTECIPADO_SIMPLES)
        and note.origem_data_entrada != "manual"
    ):
        entry_date = None
    else:
        entry_date = note.data_entrada

    subitem_index = int(metadata.get("subitem_index") or note.item_numero or 1)
    numero_nota_formatado = f"{note.numero_nota}*" if subitem_index > 1 else note.numero_nota

    return {
        "numero_nota": numero_nota_formatado,
        "serie": note.serie,
        "chave_acesso": note.chave_acesso,
        "cnpj_emitente": note.cnpj_emitente,
        "uf_emitente": note.uf_emitente,
        "cnpj_destinatario": note.cnpj_destinatario,
        "uf_destinatario": note.uf_destinatario,
        "data_emissao": issue_date,
        "data_entrada": entry_date,
        "item_numero": note.item_numero,
        "ncm": note.ncm,
        "cfop": note.cfop,
        "v_total": note.v_total,
        "base_calculo": note.base_calculo,
        "ipi_despesas": note.ipi_despesas,
        "mva": Decimal(str(metadata.get("mva") or "0")),
        "reducao": None,
        "red": "",
        "aliq_simples": metadata.get("aliq_simples") or "N",
        "a_ori": note.a_ori,
        "a_dst": note.a_dst_resolvida,
        "debito": note.debito,
        "credito": note.credito,
        "valor_devido": note.valor_devido,
    }


class PipelineOutputService:
    def __init__(self, db: Session):
        self.db = db

    def regenerate(self, solicitacao: Solicitacao) -> None:
        """Regenera saídas existentes com restauração local/nuvem em caso de erro."""
        backups: List[_OutputBackup] = []
        try:
            for saida in solicitacao.saidas:
                if not saida.template_id or not saida.arquivo_path:
                    continue
                template = self.db.get(TemplateXlsx, saida.template_id)
                if not template:
                    raise ValidationException(
                        f"O template da saída '{saida.tipo}' não existe mais."
                    )

                notes = (
                    self.db.query(NotaFiscalProcessada)
                    .filter(
                        NotaFiscalProcessada.solicitacao_id == solicitacao.id,
                        NotaFiscalProcessada.destino_planilha == saida.tipo,
                    )
                    .order_by(
                        func.coalesce(
                            NotaFiscalProcessada.data_entrada,
                            NotaFiscalProcessada.data_emissao,
                        ),
                        NotaFiscalProcessada.data_emissao,
                        NotaFiscalProcessada.numero_nota,
                        NotaFiscalProcessada.item_numero,
                    )
                    .all()
                )
                rows = [processed_note_to_row(note) for note in notes]
                filename = os.path.basename(saida.arquivo_path.replace("\\", "/"))
                output_path = os.path.join(settings.OUTPUTS_DIR, filename)
                cloud_content = (
                    SupabaseStorageService.download_file(
                        settings.SUPABASE_STORAGE_BUCKET_OUTPUTS,
                        filename,
                    )
                    if SupabaseStorageService.is_configured()
                    else None
                )
                backups.append(
                    _OutputBackup(
                        output_path=output_path,
                        local_content=read_bytes_if_exists(output_path),
                        filename=filename,
                        cloud_content=cloud_content,
                    )
                )

                TemplateFiller.fill_template(
                    template_path=TemplateManager.resolve_template_path(template),
                    mapping=template.mapeamento_campos,
                    rows_data=rows,
                    output_path=output_path,
                    header_info=build_header_info(
                        solicitacao.empresa,
                        solicitacao.periodo_inicio,
                        solicitacao.empresa.inscricao_estadual or "",
                    ),
                )
                self._upload_output(output_path, filename, action="atualizar")
                saida.arquivo_path = output_path
                if solicitacao.arquivo_saida_path:
                    solicitacao.arquivo_saida_path = output_path

            self.db.commit()
        except Exception:
            self.db.rollback()
            self._restore_backups(backups)
            raise

    def generate(
        self,
        *,
        solicitacao: Solicitacao,
        empresa: Empresa,
        rows_by_destination: Mapping[str, List[Dict[str, Any]]],
        legacy_mode: bool,
        legacy_template: Optional[TemplateXlsx],
        header_info: Dict[str, Any],
    ) -> GeneratedArtifacts:
        artifacts = GeneratedArtifacts()
        try:
            if legacy_mode:
                destination = solicitacao.tipo_planilha
                rows = rows_by_destination.get(destination, [])
                if not rows:
                    raise ValidationException(
                        f"Nenhuma NF-e válida encontrada para o tipo de planilha "
                        f"'{destination}' com base nas regras de CFOP cadastradas."
                    )
                try:
                    template = TemplateManager.get_active_template(
                        self.db,
                        destination,
                        required_rows=len(rows),
                    )
                except NotFoundException:
                    if legacy_template is None:
                        raise ValidationException("O template da solicitação não está disponível.")
                    template = legacy_template
                solicitacao.template_id = template.id
                output_path = self._create_output(
                    solicitacao=solicitacao,
                    empresa=empresa,
                    destination=destination,
                    rows=rows,
                    template=template,
                    header_info=header_info,
                    artifacts=artifacts,
                )
                solicitacao.arquivo_saida_path = output_path
            else:
                for destination, rows in rows_by_destination.items():
                    try:
                        template = TemplateManager.get_active_template(
                            self.db,
                            destination,
                            required_rows=len(rows),
                        )
                    except NotFoundException as exc:
                        self._add_output_record(
                            solicitacao=solicitacao,
                            destination=destination,
                            rows=rows,
                            template=None,
                            output_path=None,
                            warning=str(exc),
                        )
                        continue

                    self._create_output(
                        solicitacao=solicitacao,
                        empresa=empresa,
                        destination=destination,
                        rows=rows,
                        template=template,
                        header_info=header_info,
                        artifacts=artifacts,
                    )

            if not artifacts.local_paths:
                raise ValidationException(
                    "Nenhuma planilha pôde ser gerada porque não há template ativo "
                    "para os tipos apurados."
                )
            return artifacts
        except Exception:
            artifacts.cleanup()
            raise

    def _create_output(
        self,
        *,
        solicitacao: Solicitacao,
        empresa: Empresa,
        destination: str,
        rows: List[Dict[str, Any]],
        template: TemplateXlsx,
        header_info: Dict[str, Any],
        artifacts: GeneratedArtifacts,
    ) -> str:
        filename = (
            f"planilha_{empresa.cnpj}_{destination}_{solicitacao.id[:8]}.xlsx"
        )
        output_path = os.path.join(settings.OUTPUTS_DIR, filename)
        TemplateFiller.fill_template(
            template_path=TemplateManager.resolve_template_path(template),
            mapping=template.mapeamento_campos,
            rows_data=rows,
            output_path=output_path,
            header_info=header_info,
        )
        artifacts.local_paths.append(output_path)
        if SupabaseStorageService.is_configured():
            self._upload_output(output_path, filename, action="armazenar")
            artifacts.cloud_names.append(filename)

        self._add_output_record(
            solicitacao=solicitacao,
            destination=destination,
            rows=rows,
            template=template,
            output_path=output_path,
        )
        return output_path

    def _add_output_record(
        self,
        *,
        solicitacao: Solicitacao,
        destination: str,
        rows: List[Dict[str, Any]],
        template: Optional[TemplateXlsx],
        output_path: Optional[str],
        warning: Optional[str] = None,
    ) -> None:
        total_due = sum(
            (row["valor_devido"] for row in rows),
            Decimal("0.00"),
        )
        self.db.add(
            SolicitacaoSaida(
                solicitacao_id=solicitacao.id,
                tipo=destination,
                template_id=template.id if template else None,
                arquivo_path=output_path,
                total_notas=len(rows),
                total_valor_devido=total_due,
                aviso=warning,
            )
        )

    @staticmethod
    def _upload_output(output_path: str, filename: str, *, action: str) -> None:
        if not SupabaseStorageService.is_configured():
            return
        with open(output_path, "rb") as output_file:
            uploaded = SupabaseStorageService.upload_file(
                settings.SUPABASE_STORAGE_BUCKET_OUTPUTS,
                filename,
                output_file.read(),
            )
        if not uploaded:
            raise ValidationException(
                f"Não foi possível {action} a planilha na nuvem."
            )

    @staticmethod
    def _restore_backups(backups: List[_OutputBackup]) -> None:
        for backup in backups:
            if backup.local_content is None:
                remove_file_if_exists(backup.output_path)
            else:
                atomic_write(
                    backup.output_path,
                    backup.local_content,
                    prefix="restore_",
                )

            if not SupabaseStorageService.is_configured():
                continue
            if backup.cloud_content is None:
                SupabaseStorageService.delete_file(
                    settings.SUPABASE_STORAGE_BUCKET_OUTPUTS,
                    backup.filename,
                )
            else:
                SupabaseStorageService.upload_file(
                    settings.SUPABASE_STORAGE_BUCKET_OUTPUTS,
                    backup.filename,
                    backup.cloud_content,
                )
