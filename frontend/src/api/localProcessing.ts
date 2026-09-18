import { apiClient } from './client';
import type {
  LocalProcessingContext,
  LocalProcessingPersistPayload,
} from '../types/localProcessing';
import type { Solicitacao } from '../types/solicitacao';

export const localProcessingApi = {
  obterContexto: async (empresaId: number): Promise<LocalProcessingContext> => {
    const { data } = await apiClient.get<LocalProcessingContext>('/processamento-local/contexto', {
      params: { empresa_id: empresaId },
    });
    return data;
  },

  baixarTemplate: async (templateId: number): Promise<ArrayBuffer> => {
    const { data } = await apiClient.get<ArrayBuffer>(`/templates/${templateId}/arquivo`, {
      responseType: 'arraybuffer',
      timeout: 120_000,
    });
    return data;
  },

  persistirResultado: async (
    solicitacaoId: string,
    payload: LocalProcessingPersistPayload,
  ): Promise<Solicitacao> => {
    const { data } = await apiClient.post<Solicitacao>(
      `/processamento-local/solicitacoes/${solicitacaoId}/resultado`,
      payload,
      { timeout: 120_000 },
    );
    return data;
  },
};
