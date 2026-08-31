import { apiClient } from './client';
import type { Solicitacao, SolicitacaoCreate, NotaFiscalProcessada } from '../types/solicitacao';

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
  processar: async (
    id: string,
    files?: File[],
    planilhaEntradas?: File | null,
    spedFile?: File | null
  ): Promise<Solicitacao> => {
    const formData = new FormData();
    if (files && files.length > 0) {
      files.forEach((file) => {
        formData.append('files', file);
      });
    }
    if (spedFile) {
      formData.append('sped_file', spedFile);
    }
    if (planilhaEntradas) {
      formData.append('planilha_entradas', planilhaEntradas);
    }
    const { data } = await apiClient.post<Solicitacao>(`/solicitacoes/${id}/processar`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return data;
  },
  atualizarDataEntrada: async (
    solicitacaoId: string,
    notaId: string,
    dataEntrada: string
  ): Promise<NotaFiscalProcessada> => {
    const { data } = await apiClient.patch<NotaFiscalProcessada>(
      `/solicitacoes/${solicitacaoId}/notas/${notaId}/data-entrada`,
      { data_entrada: dataEntrada }
    );
    return data;
  },
  downloadPlanilha: async (id: string, filename?: string, tipo?: string): Promise<void> => {
    const response = await apiClient.get(`/solicitacoes/${id}/download`, {
      responseType: 'blob',
      params: tipo ? { tipo } : undefined,
    });

    const isZip = String(response.headers['content-type'] || '').includes('zip');
    const extensao = isZip ? '.zip' : '.xlsx';
    const nomeBase = filename ? filename.replace(/\.xlsx$/i, '') : `planilha_${id.slice(0, 8)}`;

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${nomeBase}${extensao}`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
