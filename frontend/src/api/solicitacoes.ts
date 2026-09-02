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
      timeout: 300_000,
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
      { data_entrada: dataEntrada },
      { timeout: 120_000 }
    );
    return data;
  },
  downloadPlanilha: async (id: string, filename?: string, tipo?: string): Promise<void> => {
    const response = await apiClient.get(`/solicitacoes/${id}/download`, {
      responseType: 'blob',
      params: tipo ? { tipo } : undefined,
      timeout: 120_000,
    });

    const isZip = String(response.headers['content-type'] || '').includes('zip');
    const extensao = isZip ? '.zip' : '.xlsx';
    const disposition = String(response.headers['content-disposition'] || '');
    const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plainFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const serverFilename = encodedFilename ? decodeURIComponent(encodedFilename) : plainFilename;
    const nomeBase = filename ? filename.replace(/\.(xlsx|zip)$/i, '') : `planilha_${id.slice(0, 8)}`;
    const downloadName = serverFilename || `${nomeBase}${extensao}`;

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', downloadName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  },
  excluir: async (id: string): Promise<void> => {
    await apiClient.delete(`/solicitacoes/${id}`);
  },
};
