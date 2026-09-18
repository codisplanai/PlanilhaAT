import { apiClient } from './client';
import type {
  Solicitacao,
  SolicitacaoCreate,
  NotaFiscalProcessada,
  SolicitacoesBatchDeleteResponse,
} from '../types/solicitacao';

export const solicitacoesApi = {
  listar: async (params?: { empresa_id?: number; status_filter?: string }): Promise<Solicitacao[]> => {
    const { data } = await apiClient.get<Solicitacao[]>('/solicitacoes', { params });
    return data;
  },
  obter: async (id: string): Promise<Solicitacao> => {
    const { data } = await apiClient.get<Solicitacao>(`/solicitacoes/${id}`);
    return data;
  },
  criar: async (payload: SolicitacaoCreate): Promise<Solicitacao> => {
    const { data } = await apiClient.post<Solicitacao>('/solicitacoes', payload);
    return data;
  },
  atualizarDataEntrada: async (
    solicitacaoId: string,
    notaId: string,
    dataEntrada: string
  ): Promise<NotaFiscalProcessada> => {
    const { data } = await apiClient.patch<NotaFiscalProcessada>(
      `/solicitacoes/${solicitacaoId}/notas/${notaId}/data-entrada`,
      { data_entrada: dataEntrada },
      { timeout: 120_000 }
    );
    return data;
  },
  excluir: async (id: string): Promise<void> => {
    await apiClient.delete(`/solicitacoes/${id}`);
  },
  excluirEmLote: async (ids: string[]): Promise<SolicitacoesBatchDeleteResponse> => {
    const { data } = await apiClient.post<SolicitacoesBatchDeleteResponse>('/solicitacoes/batch-delete', { ids });
    return data;
  },
};

