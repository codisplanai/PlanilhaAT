import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getErrorMessage } from '../../api/client';
import { localProcessingApi } from '../../api/localProcessing';
import { queryKeys } from '../../api/queryKeys';
import { solicitacoesApi } from '../../api/solicitacoes';
import { useEmpresasQuery } from '../../hooks/useApiQueries';
import type { Empresa } from '../../types/empresa';
import type {
  LocalProcessingPersistPayload,
  LocalProcessingResult,
  LocalTemplateDescriptor,
} from '../../types/localProcessing';
import type {
  Convenio5291Pendencia,
  NotaBonificacaoPendencia,
  Solicitacao,
  TipoPlanilha,
} from '../../types/solicitacao';
import {
  downloadLocalArtifacts,
  saveLocalArtifacts,
} from '../../lib/localProcessing/artifactStore';
import { processFiscalLocally } from '../../lib/localProcessing/processor';
import { getMonthPeriod } from '../../lib/periods';
import { runtimeConfig } from '../../lib/runtimeConfig';
import {
  cloneDiagnosticSession,
  createDiagnosticRecorder,
  createDiagnosticSession,
  downloadDiagnosticJson,
  downloadDiagnosticText,
} from '../../lib/processingDiagnostics';
import type { DiagnosticRecorder } from '../../lib/processingDiagnostics';
import { useFiscalInputFiles } from './useFiscalInputFiles';

function buildPersistPayload(
  result: LocalProcessingResult,
): LocalProcessingPersistPayload {
  const saidas = (Object.entries(result.rowsByDestination) as Array<
    [TipoPlanilha, NonNullable<LocalProcessingResult['rowsByDestination'][TipoPlanilha]>]
  >)
    .filter(([, rows]) => Boolean(rows?.length))
    .map(([tipo, rows]) => {
      const artifact = result.artifacts.find((item) => item.tipo === tipo);
      return {
        tipo,
        template_id: artifact?.templateId ?? null,
        total_notas: rows.length,
        total_valor_devido: rows.reduce((sum, row) => sum + Number(row.valor_devido), 0),
        aviso: artifact ? null : `Nenhum template ativo cadastrado para ${tipo}.`,
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

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function loadOfficialTemplate(template: LocalTemplateDescriptor): Promise<ArrayBuffer> {
  let bytes: ArrayBuffer;
  try {
    bytes = await localProcessingApi.baixarTemplate(template.id);
  } catch (error) {
    throw new Error(
      `Não foi possível carregar o modelo oficial ${template.tipo} v${template.versao}: ${getErrorMessage(error)}`,
    );
  }

  const expectedHash = template.arquivo_hash.trim().toLowerCase();
  if (expectedHash) {
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== expectedHash) {
      throw new Error(
        `O modelo oficial ${template.tipo} v${template.versao} recebido não corresponde à versão ativa. `
        + 'O processamento foi bloqueado para evitar gerar uma planilha a partir do arquivo errado.',
      );
    }
  }
  return bytes;
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
  // Protege contra clique duplo: ``isProcessing`` só vale a partir do próximo
  // render e não impede duas chamadas disparadas no mesmo quadro.
  const processingGuardRef = useRef(false);
  // Identifica a solicitação já criada para o mesmo contexto. Sem isso, cada
  // nova tentativa deixava uma solicitação "pendente" órfã no histórico.
  const pendingRequestRef = useRef<{
    id: string;
    empresaId: number;
    periodoInicio: string;
    periodoFim: string;
  } | null>(null);
  const [pendenciasBonificacao, setPendenciasBonificacao] = useState<NotaBonificacaoPendencia[]>([]);
  const [showModalBonificacao, setShowModalBonificacao] = useState(false);
  const [pendenciasConvenio5291, setPendenciasConvenio5291] = useState<Convenio5291Pendencia[]>([]);
  const [showModalConvenio5291, setShowModalConvenio5291] = useState(false);
  const bonusDecisionsRef = useRef<Record<string, boolean> | undefined>(undefined);
  const [resultadoSolicitacao, setResultadoSolicitacao] = useState<Solicitacao | null>(null);
  const [localArtifactTypes, setLocalArtifactTypes] = useState<TipoPlanilha[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const diagnosticSessionRef = useRef(
    createDiagnosticSession(runtimeConfig.appVersion || import.meta.env.VITE_APP_VERSION || '1.0.0'),
  );
  const activeDiagnosticRef = useRef<DiagnosticRecorder | null>(null);
  const [diagnosticSession, setDiagnosticSession] = useState(
    () => cloneDiagnosticSession(diagnosticSessionRef.current),
  );
  const empresasQuery = useEmpresasQuery();

  const refreshDiagnostic = () => {
    setDiagnosticSession(cloneDiagnosticSession(diagnosticSessionRef.current));
  };

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
    bonusDecisions?: Record<string, boolean>,
    convenio5291Decisions?: Record<string, boolean>,
    diagnostic: DiagnosticRecorder | null = activeDiagnosticRef.current,
  ): Promise<void> => {
    if (!selectedEmpresa) return;

    if (diagnostic) {
      diagnostic.attempt.requestId = requestId;
      diagnostic.attempt.status = 'em_andamento';
      diagnostic.stage('configuracao', 'Carregamento das regras e modelos iniciado.');
    }
    const contextStartedAt = performance.now();
    const context = await localProcessingApi.obterContexto(selectedEmpresa.id);
    diagnostic?.event('info', 'configuracao', 'Regras fiscais carregadas.', {
      regrasAliquotas: context.regras_aliquotas.length,
      regrasCfop: context.regras_cfop.length,
      modelosAtivos: context.templates_ativos.length,
    }, Math.round(performance.now() - contextStartedAt));
    // Os arquivos XLSX são carregados somente quando a classificação fiscal
    // produzir linhas para aquele destino. Um modelo ativo não utilizado não pode
    // bloquear a leitura/transformação dos arquivos da solicitação.
    const templateBytes = new Map<number, ArrayBuffer>();

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
        bonusDecisions,
        convenio5291Decisions,
        diagnostic: diagnostic ?? undefined,
      },
      templateBytes,
      async (template) => {
        const startedAt = performance.now();
        diagnostic?.stage('geracao_planilha', 'Carregamento do modelo oficial necessário iniciado.', {
          tipo: template.tipo,
          templateId: template.id,
          versao: template.versao,
          capacidadeLinhas: template.capacidade_linhas ?? null,
        });
        const bytes = await loadOfficialTemplate(template);
        diagnostic?.event('info', 'geracao_planilha', 'Modelo oficial carregado e validado por hash.', {
          tipo: template.tipo,
          templateId: template.id,
          versao: template.versao,
          capacidadeLinhas: template.capacidade_linhas ?? null,
          tamanhoBytes: bytes.byteLength,
        }, Math.round(performance.now() - startedAt));
        return bytes;
      },
    );

    if (localResult.preAnalysis.requer_decisao && localResult.preAnalysis.notas_bonificacao.length > 0) {
      setPendenciasBonificacao(localResult.preAnalysis.notas_bonificacao);
      setShowModalBonificacao(true);
      return;
    }

    if (
      localResult.preAnalysis.requer_decisao
      && localResult.preAnalysis.itens_convenio_52_91.length > 0
    ) {
      setPendenciasConvenio5291(localResult.preAnalysis.itens_convenio_52_91);
      setShowModalConvenio5291(true);
      return;
    }

    diagnostic?.stage('registro', 'Registro do resultado estruturado iniciado.', {
      registros: localResult.notasProcessadas.length,
      saidas: localResult.artifacts.length,
    });
    const persistenceStartedAt = performance.now();
    const persisted = await localProcessingApi.persistirResultado(
      requestId,
      buildPersistPayload(localResult),
    );
    // A solicitação deixou de ser pendente: um cancelamento posterior não pode
    // mais apagar um resultado já registrado.
    if (pendingRequestRef.current?.id === requestId) pendingRequestRef.current = null;
    diagnostic?.event('info', 'registro', 'Resultado estruturado registrado sem conteúdo fiscal bruto.', {
      solicitacaoId: requestId,
    }, Math.round(performance.now() - persistenceStartedAt));

    let artifactStorageFailed = false;
    try {
      diagnostic?.stage('armazenamento_resultado', 'Disponibilização das planilhas para download iniciada.');
      await saveLocalArtifacts(requestId, localResult.artifacts);
      setLocalArtifactTypes(localResult.artifacts.map((artifact) => artifact.tipo));
      setDownloadError(null);
      diagnostic?.event('info', 'armazenamento_resultado', 'Planilhas disponíveis para download nesta sessão.', {
        quantidade: localResult.artifacts.length,
        tamanhoTotalBytes: localResult.artifacts.reduce((sum, artifact) => sum + artifact.bytes.byteLength, 0),
      });
    } catch (storageError) {
      artifactStorageFailed = true;
      setLocalArtifactTypes([]);
      setDownloadError(
        `A apuração foi concluída, mas as planilhas não ficaram disponíveis para download: ${getErrorMessage(storageError)}`,
      );
      diagnostic?.error(
        'armazenamento_resultado',
        storageError,
        'A apuração foi registrada, mas as planilhas não ficaram disponíveis para download.',
      );
    }

    setShowModalBonificacao(false);
    setPendenciasBonificacao([]);
    setShowModalConvenio5291(false);
    setPendenciasConvenio5291([]);
    bonusDecisionsRef.current = undefined;
    setResultadoSolicitacao(persisted);
    if (artifactStorageFailed) {
      diagnostic?.finish('parcialmente_concluido', 'Processamento concluído parcialmente: resultado registrado sem arquivo disponível para download.');
    } else {
      const hasWarnings = localResult.notasIgnoradas.length > 0
        || localResult.avisosAvaliacao.length > 0
        || Object.keys(localResult.cfopsSemRegra).length > 0;
      diagnostic?.finish(
        hasWarnings ? 'concluido_com_avisos' : 'concluido',
        hasWarnings ? 'Processamento concluído com avisos.' : 'Processamento e geração concluídos.',
      );
    }
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.solicitacoesRoot });
    } catch (refreshError) {
      diagnostic?.event('warning', 'atualizacao_interface', 'A planilha foi gerada, mas o histórico não pôde ser atualizado automaticamente.', {
        tipo: refreshError instanceof Error ? refreshError.name : typeof refreshError,
      });
      if (diagnostic?.attempt.status === 'concluido') {
        diagnostic.attempt.status = 'concluido_com_avisos';
        refreshDiagnostic();
      }
    }
  };

  /** Remove, em melhor esforço, uma solicitação criada mas nunca concluída. */
  const discardPendingRequest = async (): Promise<void> => {
    const pending = pendingRequestRef.current;
    pendingRequestRef.current = null;
    if (!pending) return;
    try {
      await solicitacoesApi.excluir(pending.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.solicitacoesRoot });
    } catch {
      // O registro pode já ter sido concluído ou removido; nada a compensar.
    }
  };

  /**
   * Reaproveita a solicitação já criada para a mesma empresa e período. O
   * endpoint de resultado substitui notas e saídas anteriores, então repetir a
   * tentativa sobre o mesmo registro é seguro e evita acumular solicitações
   * "pendentes" que nunca serão concluídas.
   */
  const ensureRequestId = async (empresaId: number): Promise<string> => {
    const reusable = pendingRequestRef.current;
    if (
      reusable
      && reusable.empresaId === empresaId
      && reusable.periodoInicio === periodoInicio
      && reusable.periodoFim === periodoFim
    ) {
      return reusable.id;
    }

    if (reusable) await discardPendingRequest();

    const request = await solicitacoesApi.criar({
      empresa_id: empresaId,
      periodo_inicio: periodoInicio,
      periodo_fim: periodoFim,
    });
    pendingRequestRef.current = {
      id: request.id,
      empresaId,
      periodoInicio,
      periodoFim,
    };
    setSolicitacaoIdAtiva(request.id);
    return request.id;
  };

  const generateSpreadsheet = async () => {
    if (processingGuardRef.current) return;
    if (!selectedEmpresa) return;
    if (!validatePeriod()) return;
    if (files.xmlFiles.length === 0 && !files.spedFile) {
      setErrorMessage('Selecione os XMLs de NF-e, o arquivo SPED Fiscal, ou ambos.');
      return;
    }

    processingGuardRef.current = true;
    setErrorMessage(null);
    setDownloadError(null);
    setIsProcessing(true);
    const diagnostic = createDiagnosticRecorder(
      diagnosticSessionRef.current,
      [...files.xmlFiles, ...(files.spedFile ? [files.spedFile] : []), ...(files.planilhaEntradaFile ? [files.planilhaEntradaFile] : [])],
      refreshDiagnostic,
    );
    activeDiagnosticRef.current = diagnostic;
    try {
      diagnostic.stage('solicitacao', 'Criação da solicitação iniciada.');
      const requestId = await ensureRequestId(selectedEmpresa.id);
      diagnostic.attempt.requestId = requestId;
      diagnostic.event('info', 'solicitacao', 'Solicitação criada.', { solicitacaoId: requestId });
      bonusDecisionsRef.current = undefined;
      await executeLocalProcessing(requestId, undefined, undefined, diagnostic);
    } catch (error) {
      diagnostic.error(diagnostic.attempt.currentStage, error, 'O processamento não pôde ser concluído.');
      diagnostic.finish('falhou', 'Tentativa encerrada com falha.');
      setErrorMessage(getErrorMessage(error));
    } finally {
      processingGuardRef.current = false;
      setIsProcessing(false);
    }
  };

  const confirmarBonificacoesEProcessar = async (decisoes: Record<string, boolean>) => {
    if (processingGuardRef.current) return;
    if (!solicitacaoIdAtiva) return;
    processingGuardRef.current = true;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const diagnostic = activeDiagnosticRef.current;
      bonusDecisionsRef.current = decisoes;
      diagnostic?.event('info', 'validacao', 'Decisões de bonificação recebidas; processamento retomado.', {
        quantidadeDecisoes: Object.keys(decisoes).length,
      });
      setShowModalBonificacao(false);
      await executeLocalProcessing(solicitacaoIdAtiva, decisoes, undefined, diagnostic);
    } catch (error) {
      activeDiagnosticRef.current?.error(
        activeDiagnosticRef.current.attempt.currentStage,
        error,
        'O processamento não pôde ser concluído após a confirmação.',
      );
      activeDiagnosticRef.current?.finish('falhou', 'Tentativa encerrada com falha.');
      setErrorMessage(getErrorMessage(error));
    } finally {
      processingGuardRef.current = false;
      setIsProcessing(false);
    }
  };

  const confirmarConvenio5291EProcessar = async (decisoes: Record<string, boolean>) => {
    if (processingGuardRef.current) return;
    if (!solicitacaoIdAtiva) return;
    processingGuardRef.current = true;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const diagnostic = activeDiagnosticRef.current;
      diagnostic?.event('info', 'validacao', 'Decisões do Convênio ICMS 52/91 recebidas; processamento retomado.', {
        quantidadeDecisoes: Object.keys(decisoes).length,
      });
      setShowModalConvenio5291(false);
      await executeLocalProcessing(
        solicitacaoIdAtiva,
        bonusDecisionsRef.current,
        decisoes,
        diagnostic,
      );
    } catch (error) {
      activeDiagnosticRef.current?.error(
        activeDiagnosticRef.current.attempt.currentStage,
        error,
        'O processamento não pôde ser concluído após a confirmação do Convênio ICMS 52/91.',
      );
      activeDiagnosticRef.current?.finish('falhou', 'Tentativa encerrada com falha.');
      setErrorMessage(getErrorMessage(error));
    } finally {
      processingGuardRef.current = false;
      setIsProcessing(false);
    }
  };

  const cancelarModalConvenio5291 = () => {
    if (processingGuardRef.current) return;
    activeDiagnosticRef.current?.finish('cancelado', 'Processamento cancelado durante a confirmação do Convênio ICMS 52/91.');
    setShowModalConvenio5291(false);
    setPendenciasConvenio5291([]);
    bonusDecisionsRef.current = undefined;
    setIsProcessing(false);
    setSolicitacaoIdAtiva(null);
    void discardPendingRequest();
  };

  const cancelarModalBonificacao = () => {
    // O botão "Cancelar" já fica desabilitado durante o processamento, mas o
    // mesmo ``onClose`` também chega por Esc e pelo clique no fundo do modal:
    // descartar a solicitação no meio da apuração faria o registro do
    // resultado falhar com 404.
    if (processingGuardRef.current) return;
    activeDiagnosticRef.current?.finish('cancelado', 'Processamento cancelado durante a confirmação de bonificações.');
    setShowModalBonificacao(false);
    setPendenciasBonificacao([]);
    bonusDecisionsRef.current = undefined;
    setIsProcessing(false);
    setSolicitacaoIdAtiva(null);
    // Nada foi apurado: manter o registro deixaria o histórico com uma
    // solicitação eternamente pendente para cada cancelamento.
    void discardPendingRequest();
  };

  const downloadSpreadsheet = async (tipo?: TipoPlanilha) => {
    if (!resultadoSolicitacao) return;
    setDownloadError(null);
    try {
      await downloadLocalArtifacts(resultadoSolicitacao.id, tipo);
      activeDiagnosticRef.current?.event('info', 'download', 'Download da planilha solicitado pelo usuário.', {
        tipo: tipo ?? 'todas',
      });
    } catch (error) {
      activeDiagnosticRef.current?.error('download', error, 'Falha ao preparar o download da planilha.', {
        tipo: tipo ?? 'todas',
      });
      setDownloadError(getErrorMessage(error));
    }
  };

  const startNewRequest = () => {
    void discardPendingRequest();
    setResultadoSolicitacao(null);
    setDownloadError(null);
    setErrorMessage(null);
    setSolicitacaoIdAtiva(null);
    setPendenciasBonificacao([]);
    setShowModalBonificacao(false);
    setPendenciasConvenio5291([]);
    setShowModalConvenio5291(false);
    bonusDecisionsRef.current = undefined;
    setLocalArtifactTypes([]);
    files.resetFiles();
    setCurrentStep(1);
  };

  const clearDiagnostic = () => {
    if (isProcessing) return;
    diagnosticSessionRef.current = createDiagnosticSession(
      runtimeConfig.appVersion || import.meta.env.VITE_APP_VERSION || '1.0.0',
    );
    activeDiagnosticRef.current = null;
    refreshDiagnostic();
  };

  const exportDiagnosticText = () => {
    const recorder = activeDiagnosticRef.current;
    recorder?.event('info', 'diagnostico', 'Exportação do diagnóstico em texto solicitada.');
    downloadDiagnosticText(diagnosticSessionRef.current);
  };

  const exportDiagnosticJson = () => {
    const recorder = activeDiagnosticRef.current;
    recorder?.event('info', 'diagnostico', 'Exportação do diagnóstico em JSON solicitada.');
    downloadDiagnosticJson(diagnosticSessionRef.current);
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
    pendenciasConvenio5291,
    showModalConvenio5291,
    confirmarConvenio5291EProcessar,
    cancelarModalConvenio5291,
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
    diagnosticSession,
    clearDiagnostic,
    exportDiagnosticText,
    exportDiagnosticJson,
  };
}
