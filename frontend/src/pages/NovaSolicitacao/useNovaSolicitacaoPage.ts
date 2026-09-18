import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getErrorMessage } from '../../api/client';
import { localProcessingApi } from '../../api/localProcessing';
import { queryKeys } from '../../api/queryKeys';
import { solicitacoesApi } from '../../api/solicitacoes';
import { useEmpresasQuery } from '../../hooks/useApiQueries';
import type { Empresa } from '../../types/empresa';
import type {
  LocalProcessingContext,
  LocalProcessingPersistPayload,
  LocalProcessingResult,
} from '../../types/localProcessing';
import type { Solicitacao, TipoPlanilha, NotaBonificacaoPendencia } from '../../types/solicitacao';
import {
  downloadLocalArtifacts,
  saveLocalArtifacts,
} from '../../lib/localProcessing/artifactStore';
import { processFiscalLocally } from '../../lib/localProcessing/processor';
import { getMonthPeriod } from '../../lib/periods';
import { useFiscalInputFiles } from './useFiscalInputFiles';

function buildPersistPayload(
  result: LocalProcessingResult,
  context: LocalProcessingContext,
): LocalProcessingPersistPayload {
  const saidas = (Object.entries(result.rowsByDestination) as Array<
    [TipoPlanilha, NonNullable<LocalProcessingResult['rowsByDestination'][TipoPlanilha]>]
  >)
    .filter(([, rows]) => Boolean(rows?.length))
    .map(([tipo, rows]) => {
      const template = context.templates_ativos.find((item) => item.tipo === tipo);
      return {
        tipo,
        template_id: template?.id ?? null,
        total_notas: rows.length,
        total_valor_devido: rows.reduce((sum, row) => sum + Number(row.valor_devido), 0),
        aviso: template ? null : `Nenhum template ativo cadastrado para ${tipo}.`,
      };
    });

  return {
    notas_processadas: result.notasProcessadas.map((note) => ({
      chave_acesso: note.chave_acesso,
      numero_nota: note.numero_nota,
      serie: note.serie,
      cnpj_emitente: note.cnpj_emitente,
      uf_emitente: note.uf_emitente,
      cnpj_destinatario: note.cnpj_destinatario,
      uf_destinatario: note.uf_destinatario,
      data_emissao: note.data_emissao,
      data_entrada: note.data_entrada,
      origem_data_entrada: note.origem_data_entrada,
      item_numero: note.item_numero,
      ncm: note.ncm,
      cfop: note.cfop,
      destino_planilha: note.destino_planilha,
      v_total: Number(note.v_total),
      base_calculo: Number(note.base_calculo),
      ipi_despesas: Number(note.ipi_despesas),
      a_ori: Number(note.a_ori),
      a_dst_resolvida: Number(note.a_dst_resolvida),
      debito: Number(note.debito),
      credito: Number(note.credito),
      valor_devido: Number(note.valor_devido),
      metadados_extras: note.metadados_extras as Record<string, unknown>,
    })),
    saidas,
    notas_ignoradas: result.notasIgnoradas,
    itens_excluidos: result.itensExcluidos,
    avisos_avaliacao: result.avisosAvaliacao,
    cfops_sem_regra: result.cfopsSemRegra,
    mensagem: result.mensagem ?? null,
  };
}

async function loadTemplates(context: LocalProcessingContext): Promise<Map<number, ArrayBuffer>> {
  const entries = await Promise.all(
    context.templates_ativos.map(async (template) => [
      template.id,
      await localProcessingApi.baixarTemplate(template.id),
    ] as const),
  );
  return new Map(entries);
}

export function useNovaSolicitacaoPage() {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedEmpresa, setSelectedEmpresa] = useState<Empresa | null>(null);
  const [empresaSearch, setEmpresaSearch] = useState('');
  const [initialPeriod] = useState(getMonthPeriod);
  const [periodoInicio, setPeriodoInicio] = useState(initialPeriod.start);
  const [periodoFim, setPeriodoFim] = useState(initialPeriod.end);
  const files = useFiscalInputFiles();
  const [isProcessing, setIsProcessing] = useState(false);
  const [solicitacaoIdAtiva, setSolicitacaoIdAtiva] = useState<string | null>(null);
  const [pendenciasBonificacao, setPendenciasBonificacao] = useState<NotaBonificacaoPendencia[]>([]);
  const [showModalBonificacao, setShowModalBonificacao] = useState(false);
  const [resultadoSolicitacao, setResultadoSolicitacao] = useState<Solicitacao | null>(null);
  const [localArtifactTypes, setLocalArtifactTypes] = useState<TipoPlanilha[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const empresasQuery = useEmpresasQuery();

  const filteredEmpresas = (empresasQuery.data ?? []).filter((empresa) => {
    const term = empresaSearch.toLowerCase();
    const digits = term.replace(/\D/g, '');
    return empresa.ativo && (
      empresa.razao_social.toLowerCase().includes(term)
      || (digits.length > 0 && empresa.cnpj.includes(digits))
      || empresa.uf.toLowerCase().includes(term)
    );
  });

  const validatePeriod = (): boolean => {
    if (!periodoInicio || !periodoFim) {
      setErrorMessage('Informe a data inicial e a data final do período de apuração.');
      return false;
    }
    if (periodoFim < periodoInicio) {
      setErrorMessage('A data final do período não pode ser anterior à data inicial.');
      return false;
    }
    setErrorMessage(null);
    return true;
  };

  const advanceFromPeriod = () => {
    if (validatePeriod()) setCurrentStep(3);
  };

  const executeLocalProcessing = async (
    requestId: string,
    decisions?: Record<string, boolean>,
  ): Promise<void> => {
    if (!selectedEmpresa) return;

    const context = await localProcessingApi.obterContexto(selectedEmpresa.id);
    const templateBytes = await loadTemplates(context);

    const localResult = await processFiscalLocally(
      {
        solicitacaoId: requestId,
        periodoInicio,
        periodoFim,
        context,
        input: {
          xmlFiles: files.xmlFiles,
          spedFile: files.spedFile,
          entrySheet: files.planilhaEntradaFile,
        },
        bonusDecisions: decisions,
      },
      templateBytes,
    );

    if (localResult.preAnalysis.requer_decisao && localResult.preAnalysis.notas_bonificacao.length > 0) {
      setPendenciasBonificacao(localResult.preAnalysis.notas_bonificacao);
      setShowModalBonificacao(true);
      return;
    }

    const persisted = await localProcessingApi.persistirResultado(
      requestId,
      buildPersistPayload(localResult, context),
    );

    try {
      await saveLocalArtifacts(requestId, localResult.artifacts);
      setLocalArtifactTypes(localResult.artifacts.map((artifact) => artifact.tipo));
      setDownloadError(null);
    } catch (storageError) {
      setLocalArtifactTypes([]);
      setDownloadError(
        `A apuração foi concluída, mas o navegador não conseguiu armazenar as planilhas locais: ${getErrorMessage(storageError)}`,
      );
    }

    setShowModalBonificacao(false);
    setPendenciasBonificacao([]);
    setResultadoSolicitacao(persisted);
    await queryClient.invalidateQueries({ queryKey: queryKeys.solicitacoesRoot });
  };

  const generateSpreadsheet = async () => {
    if (!selectedEmpresa) return;
    if (!validatePeriod()) return;
    if (files.xmlFiles.length === 0 && !files.spedFile) {
      setErrorMessage('Selecione os XMLs de NF-e, o arquivo SPED Fiscal, ou ambos.');
      return;
    }

    setErrorMessage(null);
    setDownloadError(null);
    setIsProcessing(true);
    try {
      const request = await solicitacoesApi.criar({
        empresa_id: selectedEmpresa.id,
        periodo_inicio: periodoInicio,
        periodo_fim: periodoFim,
      });
      setSolicitacaoIdAtiva(request.id);
      await executeLocalProcessing(request.id);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmarBonificacoesEProcessar = async (decisoes: Record<string, boolean>) => {
    if (!solicitacaoIdAtiva) return;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      await executeLocalProcessing(solicitacaoIdAtiva, decisoes);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsProcessing(false);
    }
  };

  const cancelarModalBonificacao = () => {
    setShowModalBonificacao(false);
    setIsProcessing(false);
  };

  const downloadSpreadsheet = async (tipo?: TipoPlanilha) => {
    if (!resultadoSolicitacao) return;
    setDownloadError(null);
    try {
      await downloadLocalArtifacts(resultadoSolicitacao.id, tipo);
    } catch (error) {
      setDownloadError(getErrorMessage(error));
    }
  };

  const startNewRequest = () => {
    setResultadoSolicitacao(null);
    setDownloadError(null);
    setSolicitacaoIdAtiva(null);
    setPendenciasBonificacao([]);
    setShowModalBonificacao(false);
    setLocalArtifactTypes([]);
    files.resetFiles();
    setCurrentStep(1);
  };

  return {
    currentStep,
    setCurrentStep,
    selectedEmpresa,
    setSelectedEmpresa,
    empresaSearch,
    setEmpresaSearch,
    periodoInicio,
    setPeriodoInicio,
    periodoFim,
    setPeriodoFim,
    ...files,
    isProcessing,
    resultadoSolicitacao,
    localArtifactTypes,
    hasLocalArtifact: (tipo: TipoPlanilha) => localArtifactTypes.includes(tipo),
    hasAnyLocalArtifact: localArtifactTypes.length > 0,
    pendenciasBonificacao,
    showModalBonificacao,
    confirmarBonificacoesEProcessar,
    cancelarModalBonificacao,
    errorMessage,
    setErrorMessage,
    downloadError,
    setDownloadError,
    advanceFromPeriod,
    validatePeriod,
    empresasQuery,
    filteredEmpresas,
    generateSpreadsheet,
    downloadSpreadsheet,
    startNewRequest,
  };
}
