import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getErrorMessage } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { solicitacoesApi } from '../../api/solicitacoes';
import { useEmpresasQuery, useSolicitacoesQuery, useUsuariosQuery } from '../../hooks/useApiQueries';
import {
  deleteLocalArtifacts,
  deleteMultipleLocalArtifacts,
  downloadLocalArtifacts,
  getStoredRequestIds,
} from '../../lib/localProcessing/artifactStore';
import { isAdminOrSenior } from '../../lib/permissions';
import type { User } from '../../types/auth';
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

export function useHistoricoPage(currentUser?: User | null) {
  const queryClient = useQueryClient();
  const isAdminOrSeniorUser = isAdminOrSenior(currentUser);
  const [empresaFilter, setEmpresaFilter] = useState<number | undefined>();
  const [statusFilter, setStatusFilter] = useState('');
  const [usuarioFilter, setUsuarioFilter] = useState('');
  const [selectedSolicitacaoId, setSelectedSolicitacaoId] = useState<string | null>(null);
  const [editingNota, setEditingNota] = useState<NotaFiscalProcessada | null>(null);
  const [manualDateInput, setManualDateInput] = useState('');
  const [solicitacaoParaExcluir, setSolicitacaoParaExcluir] = useState<Solicitacao | null>(null);
  const [availableLocalIds, setAvailableLocalIds] = useState<Set<string>>(new Set());

  // Seleção múltipla para exclusão em lote
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteModalOpen, setBatchDeleteModalOpen] = useState(false);

  const [entryDateError, setEntryDateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Limpa a seleção sempre que os filtros mudarem para evitar exclusão acidental de itens ocultos
  useEffect(() => {
    setSelectedIds(new Set());
  }, [empresaFilter, statusFilter, usuarioFilter]);

  const solicitacoesQuery = useSolicitacoesQuery(
    empresaFilter,
    statusFilter,
    isAdminOrSeniorUser ? (usuarioFilter || undefined) : undefined,
  );
  const empresasQuery = useEmpresasQuery();
  const empresas = empresasQuery.data ?? [];
  const usuariosQuery = useUsuariosQuery(isAdminOrSeniorUser);
  const usuarios = usuariosQuery.data ?? [];

  // Consulta IDs dos artefatos disponíveis localmente neste navegador
  useEffect(() => {
    let active = true;
    getStoredRequestIds()
      .then((ids) => {
        if (active) setAvailableLocalIds(ids);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [solicitacoesQuery.data]);

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
      if (selectedSolicitacaoId) {
        await deleteLocalArtifacts(selectedSolicitacaoId).catch(() => undefined);
        setDownloadError(
          'A data de entrada foi atualizada. As planilhas anteriores foram invalidadas para evitar uso de um arquivo desatualizado; reprocesse os arquivos originais para gerar novas planilhas.',
        );
      }
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
    mutationFn: async (id: string) => {
      await solicitacoesApi.excluir(id);
      await deleteLocalArtifacts(id).catch(() => undefined);
      return id;
    },
    onSuccess: async (deletedId) => {
      // O detalhe precisa sair do cache: mantido, ele reapareceria montado a
      // partir de dados de um registro que já não existe no servidor.
      queryClient.removeQueries({ queryKey: queryKeys.solicitacao(deletedId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.solicitacoesRoot });
      if (selectedSolicitacaoId === deletedId) {
        setSelectedSolicitacaoId(null);
      }
      setSolicitacaoParaExcluir(null);
      setDeleteError(null);
    },
    onError: (error) => {
      setDeleteError(getErrorMessage(error));
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await solicitacoesApi.excluirEmLote(ids);
      await deleteMultipleLocalArtifacts(ids).catch(() => undefined);
      return ids;
    },
    onSuccess: async (deletedIds) => {
      for (const id of deletedIds) {
        queryClient.removeQueries({ queryKey: queryKeys.solicitacao(id) });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.solicitacoesRoot });
      if (selectedSolicitacaoId && selectedIds.has(selectedSolicitacaoId)) {
        setSelectedSolicitacaoId(null);
      }
      setSelectedIds(new Set());
      setBatchDeleteModalOpen(false);
      setDeleteError(null);
    },
    onError: (error) => {
      setDeleteError(getErrorMessage(error));
    },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = (visibleIds: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      return new Set(visibleIds);
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

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
      await downloadLocalArtifacts(request.id);
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
    usuarioFilter,
    setUsuarioFilter,
    isAdminOrSenior: isAdminOrSeniorUser,
    usuarios,
    availableLocalIds,
    selectedSolicitacaoId,
    setSelectedSolicitacaoId,
    editingNota,
    setEditingNota,
    manualDateInput,
    setManualDateInput,
    solicitacaoParaExcluir,
    setSolicitacaoParaExcluir,
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    isBatchDeleteModalOpen,
    setBatchDeleteModalOpen,
    deleteBatchRequests: () => {
      const ids = Array.from(selectedIds);
      // Sem itens marcados não há o que excluir: disparar a mutation enviaria
      // um lote vazio ao servidor e deixaria o modal em estado de carregamento.
      if (ids.length === 0) {
        setBatchDeleteModalOpen(false);
        return;
      }
      deleteBatchMutation.mutate(ids);
    },
    isDeletingBatch: deleteBatchMutation.isPending,
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

