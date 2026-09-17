import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getErrorMessage } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { solicitacoesApi } from '../../api/solicitacoes';
import { useEmpresasQuery } from '../../hooks/useApiQueries';
import type { Empresa } from '../../types/empresa';
import type { Solicitacao, TipoPlanilha, NotaBonificacaoPendencia } from '../../types/solicitacao';
import { getMonthPeriod } from '../../lib/periods';
import { useFiscalInputFiles } from './useFiscalInputFiles';

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
    if (validatePeriod()) {
      setCurrentStep(3);
    }
  };

  const generateSpreadsheet = async () => {
    if (!selectedEmpresa) return;
    if (!validatePeriod()) return;
    if (files.xmlFiles.length === 0 && !files.spedFile) {
      setErrorMessage('Envie os XMLs de NF-e, o arquivo SPED Fiscal, ou ambos.');
      return;
    }

    setErrorMessage(null);
    setIsProcessing(true);
    try {
      const request = await solicitacoesApi.criar({
        empresa_id: selectedEmpresa.id,
        periodo_inicio: periodoInicio,
        periodo_fim: periodoFim,
      });
      setSolicitacaoIdAtiva(request.id);

      // 1. Pré-análise de bonificação e amostra grátis
      const preAnalise = await solicitacoesApi.preAnalisar(
        request.id,
        files.xmlFiles.length > 0 ? files.xmlFiles : undefined,
        files.planilhaEntradaFile,
        files.spedFile ?? undefined,
      );

      if (preAnalise.requer_decisao && preAnalise.notas_bonificacao.length > 0) {
        setPendenciasBonificacao(preAnalise.notas_bonificacao);
        setShowModalBonificacao(true);
        setIsProcessing(false);
        return;
      }

      // Se não houver bonificação/amostra que requer confirmação, processa diretamente
      const processedRequest = await solicitacoesApi.processar(
        request.id,
        files.xmlFiles.length > 0 ? files.xmlFiles : undefined,
        files.planilhaEntradaFile,
        files.spedFile ?? undefined,
      );
      setResultadoSolicitacao(processedRequest);
      await queryClient.invalidateQueries({ queryKey: queryKeys.solicitacoesRoot });
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
      const processedRequest = await solicitacoesApi.processar(
        solicitacaoIdAtiva,
        files.xmlFiles.length > 0 ? files.xmlFiles : undefined,
        files.planilhaEntradaFile,
        files.spedFile ?? undefined,
        decisoes
      );
      setShowModalBonificacao(false);
      setResultadoSolicitacao(processedRequest);
      await queryClient.invalidateQueries({ queryKey: queryKeys.solicitacoesRoot });
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
      const companyName = selectedEmpresa?.razao_social.slice(0, 15).replace(/\s+/g, '_') || 'Empresa';
      const filename = `Planilha_${tipo || 'todas'}_${companyName}_${periodoInicio.slice(0, 7)}.xlsx`;
      await solicitacoesApi.downloadPlanilha(resultadoSolicitacao.id, filename, tipo);
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
