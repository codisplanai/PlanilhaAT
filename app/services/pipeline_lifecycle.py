"""Persistência e transições de estado do caso de uso de processamento."""

from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.constants import STATUS_CONCLUIDO, STATUS_ERRO, STATUS_PENDENTE, STATUS_PROCESSANDO
from app.core.exceptions import NotFoundException, PlanilhaATException, ValidationException
from app.models.empresa import Empresa
from app.models.nota_fiscal import NotaFiscalProcessada
from app.models.solicitacao import Solicitacao
from app.services.pipeline_outputs import GeneratedArtifacts


class PipelineLifecycle:
    def __init__(self, db: Session):
        self.db = db

    def get_solicitacao(self, solicitacao_id: str) -> Solicitacao:
        solicitacao = self.db.get(Solicitacao, solicitacao_id)
        if not solicitacao:
            raise NotFoundException(f"Solicitação ID '{solicitacao_id}' não encontrada.")
        return solicitacao

    def get_empresa(self, empresa_id: int) -> Empresa:
        empresa = self.db.get(Empresa, empresa_id)
        if not empresa:
            raise NotFoundException(f"Empresa ID '{empresa_id}' não encontrada.")
        return empresa

    def claim(self, solicitacao: Solicitacao) -> None:
        claimed = (
            self.db.query(Solicitacao)
            .filter(
                Solicitacao.id == solicitacao.id,
                Solicitacao.status.in_([STATUS_PENDENTE, STATUS_ERRO]),
            )
            .update({Solicitacao.status: STATUS_PROCESSANDO}, synchronize_session=False)
        )
        if claimed != 1:
            raise ValidationException("Esta solicitação já está sendo processada ou foi concluída.")
        self.db.commit()
        self.db.refresh(solicitacao)

    def complete_without_output(
        self,
        solicitacao: Solicitacao,
        *,
        ignored_notes: List[Dict[str, Any]],
        excluded_items: List[Dict[str, Any]],
        evaluation_warnings: List[Dict[str, Any]],
        message: str,
    ) -> Solicitacao:
        return self._complete(
            solicitacao,
            processed_notes=[],
            ignored_notes=ignored_notes,
            excluded_items=excluded_items,
            evaluation_warnings=evaluation_warnings,
            missing_cfops={},
            message=message,
        )

    def complete(
        self,
        solicitacao: Solicitacao,
        *,
        processed_notes: List[NotaFiscalProcessada],
        ignored_notes: List[Dict[str, Any]],
        excluded_items: List[Dict[str, Any]],
        evaluation_warnings: List[Dict[str, Any]],
        missing_cfops: Dict[str, int],
    ) -> Solicitacao:
        return self._complete(
            solicitacao,
            processed_notes=processed_notes,
            ignored_notes=ignored_notes,
            excluded_items=excluded_items,
            evaluation_warnings=evaluation_warnings,
            missing_cfops=missing_cfops,
            message=None,
        )

    def _complete(
        self,
        solicitacao: Solicitacao,
        *,
        processed_notes: List[NotaFiscalProcessada],
        ignored_notes: List[Dict[str, Any]],
        excluded_items: List[Dict[str, Any]],
        evaluation_warnings: List[Dict[str, Any]],
        missing_cfops: Dict[str, int],
        message: str | None,
    ) -> Solicitacao:
        solicitacao.status = STATUS_CONCLUIDO
        solicitacao.total_notas_processadas = len(processed_notes)
        solicitacao.notas_ignoradas = ignored_notes
        solicitacao.itens_excluidos = excluded_items
        solicitacao.avisos_avaliacao = evaluation_warnings
        solicitacao.cfops_sem_regra = dict(missing_cfops)
        solicitacao.mensagem_erro = message
        self.db.commit()
        self.db.refresh(solicitacao)
        return solicitacao

    def fail(
        self,
        solicitacao: Solicitacao,
        artifacts: GeneratedArtifacts,
        error: Exception,
    ) -> None:
        self.db.rollback()
        artifacts.cleanup()
        solicitacao.status = STATUS_ERRO
        solicitacao.mensagem_erro = (
            str(error)
            if isinstance(error, PlanilhaATException)
            else "Falha interna ao processar os arquivos."
        )
        self.db.commit()
