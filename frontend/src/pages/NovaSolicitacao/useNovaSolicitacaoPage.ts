import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getErrorMessage } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { solicitacoesApi } from '../../api/solicitacoes';
import { useEmpresasQuery } from '../../hooks/useApiQueries';
import type { Empresa } from '../../types/empresa';
import type { Solicitacao, TipoPlanilha } from '../../types/solicitacao';
import { useFiscalInputFiles } from './useFiscalInputFiles';

export const REQUEST_STEPS = [
  { num: 1, label: 'Empresa' },
  { num: 2, label: 'Período' },
  { num: 3, label: 'XMLs e Dados' },
  { num: 4, label: 'Resultado' },
] as const;

function currentMonthPeriod() {
  const today = new Date();
  return {
    start: new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0],
    end: new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0],
  };
}

export function useNovaSolicitacaoPage() {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedEmpresa, setSelectedEmpresa] = useState<Empresa | null>(null);
  const [empresaSearch, setEmpresaSearch] = useState('');
  const [initialPeriod] = useState(currentMonthPeriod);
  const [periodoInicio, setPeriodoInicio] = useState(initialPeriod.start);
  const [periodoFim, setPeriodoFim] = useState(initialPeriod.end);
  const files = useFiscalInputFiles();
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultadoSolicitacao, setResultadoSolicitacao] = useState<Solicitacao | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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

  const generateSpreadsheet = async () => {
    if (!selectedEmpresa) return;
    if (!periodoInicio || !periodoFim || periodoFim < periodoInicio) {
      setErrorMessage('O período final não pode ser anterior ao período inicial.');
      return;
    }
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

  const downloadSpreadsheet = async (tipo?: TipoPlanilha) => {
    if (!resultadoSolicitacao) return;
    try {
      const companyName = selectedEmpresa?.razao_social.slice(0, 15).replace(/\s+/g, '_') || 'Empresa';
      const filename = `Planilha_${tipo || 'todas'}_${companyName}_${periodoInicio.slice(0, 7)}.xlsx`;
      await solicitacoesApi.downloadPlanilha(resultadoSolicitacao.id, filename, tipo);
    } catch (error) {
      alert(getErrorMessage(error));
    }
  };

  const startNewRequest = () => {
    setResultadoSolicitacao(null);
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
    errorMessage,
    setErrorMessage,
    empresasQuery,
    filteredEmpresas,
    generateSpreadsheet,
    downloadSpreadsheet,
    startNewRequest,
  };
}
