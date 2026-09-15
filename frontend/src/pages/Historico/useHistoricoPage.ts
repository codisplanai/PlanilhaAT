import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getErrorMessage } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { solicitacoesApi } from '../../api/solicitacoes';
import { useEmpresasQuery, useSolicitacoesQuery } from '../../hooks/useApiQueries';
import type { NotaFiscalProcessada, Solicitacao } from '../../types/solicitacao';

type DetailTotals = {
  debito: number;
  credito: number;
  devido: number;
  notas: number;
};

function calculateTotals(notes: NotaFiscalProcessada[] | undefined): DetailTotals {
  return (notes ?? []).reduce<DetailTotals>(
    (totals, note) => ({
      debito: totals.debito + Number(note.debito),
      credito: totals.credito + Number(note.credito),
      devido: totals.devido + Number(note.valor_devido),
      notas: totals.notas + Number(note.v_total),
    }),
    { debito: 0, credito: 0, devido: 0, notas: 0 },
  );
}

export function useHistoricoPage() {
  const queryClient = useQueryClient();
  const [empresaFilter, setEmpresaFilter] = useState<number | undefined>();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedSolicitacaoId, setSelectedSolicitacaoId] = useState<string | null>(null);
  const [editingNota, setEditingNota] = useState<NotaFiscalProcessada | null>(null);
  const [manualDateInput, setManualDateInput] = useState('');
  const [solicitacaoParaExcluir, setSolicitacaoParaExcluir] = useState<Solicitacao | null>(null);

  const [entryDateError, setEntryDateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const solicitacoesQuery = useSolicitacoesQuery(empresaFilter, statusFilter);
  const empresasQuery = useEmpresasQuery();
  const empresas = empresasQuery.data ?? [];
  const detailQuery = useQuery({
    queryKey: queryKeys.solicitacao(selectedSolicitacaoId),
    queryFn: () => solicitacoesApi.obter(selectedSolicitacaoId!),
    enabled: Boolean(selectedSolicitacaoId),
  });

  const updateEntryDateMutation = useMutation({
    mutationFn: ({
      solicitacaoId,
      notaId,
      dataEntrada,
    }: {
      solicitacaoId: string;
      notaId: string;
      dataEntrada: string;
    }) => solicitacoesApi.atualizarDataEntrada(solicitacaoId, notaId, dataEntrada),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.solicitacao(selectedSolicitacaoId),
      });
      setEditingNota(null);
      setManualDateInput('');
      setEntryDateError(null);
    },
    onError: (error) => {
      setEntryDateError(getErrorMessage(error));
    },
  });

  const deleteRequestMutation = useMutation({
    mutationFn: (id: string) => solicitacoesApi.excluir(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.solicitacoesRoot });
      if (selectedSolicitacaoId === solicitacaoParaExcluir?.id) {
        setSelectedSolicitacaoId(null);
      }
      setSolicitacaoParaExcluir(null);
      setDeleteError(null);
    },
    onError: (error) => {
      setDeleteError(getErrorMessage(error));
    },
  });

  const openEntryDateEditor = (note: NotaFiscalProcessada) => {
    setEditingNota(note);
    setManualDateInput(note.data_entrada ? note.data_entrada.split('T')[0] : '');
    setEntryDateError(null);
  };

  const saveEntryDate = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSolicitacaoId || !editingNota || !manualDateInput) return;
    setEntryDateError(null);
    updateEntryDateMutation.mutate({
      solicitacaoId: selectedSolicitacaoId,
      notaId: editingNota.id,
      dataEntrada: manualDateInput,
    });
  };

  const downloadRequest = async (request: Solicitacao) => {
    try {
      setDownloadError(null);
      const company = empresas.find((item) => item.id === request.empresa_id);
      const companyName = company
        ? company.razao_social.slice(0, 15).replace(/\s+/g, '_')
        : 'Empresa';
      const filename = `Planilha_${request.tipo_planilha}_${companyName}_${request.periodo_inicio.slice(0, 7)}.xlsx`;
      await solicitacoesApi.downloadPlanilha(request.id, filename);
    } catch (error) {
      setDownloadError(getErrorMessage(error));
    }
  };

  const closeDetails = () => {
    setSelectedSolicitacaoId(null);
    setEditingNota(null);
    setEntryDateError(null);
  };

  return {
    solicitacoesQuery,
    empresasQuery,
    empresas,
    detailQuery,
    totals: calculateTotals(detailQuery.data?.notas_processadas),
    empresaFilter,
    setEmpresaFilter,
    statusFilter,
    setStatusFilter,
    selectedSolicitacaoId,
    setSelectedSolicitacaoId,
    editingNota,
    setEditingNota,
    manualDateInput,
    setManualDateInput,
    solicitacaoParaExcluir,
    setSolicitacaoParaExcluir,
    entryDateError,
    setEntryDateError,
    deleteError,
    setDeleteError,
    downloadError,
    setDownloadError,
    openEntryDateEditor,
    saveEntryDate,
    isUpdatingEntryDate: updateEntryDateMutation.isPending,
    deleteRequest: deleteRequestMutation.mutate,
    isDeletingRequest: deleteRequestMutation.isPending,
    downloadRequest,
    closeDetails,
    getEmpresa: (id: number) => empresas.find((empresa) => empresa.id === id),
  };
}
