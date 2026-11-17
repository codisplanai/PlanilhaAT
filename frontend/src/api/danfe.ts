import { apiClient } from './client';

export interface DanfePdfPayload {
  chave_acesso: string;
  xml: string | null;
  buscar_por_chave: boolean;
}

export const danfeApi = {
  gerarPdf: async (payload: DanfePdfPayload): Promise<Blob> => {
    const { data } = await apiClient.post<Blob>('/danfe/pdf', payload, {
      responseType: 'blob',
      timeout: 60_000,
    });
    if (!(data instanceof Blob) || !data.type.includes('pdf')) {
      throw new Error('O serviço não retornou um PDF válido.');
    }
    return data;
  },
};

