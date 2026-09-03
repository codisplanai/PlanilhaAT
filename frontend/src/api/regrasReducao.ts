import { apiClient } from './client';
import { createCrudApi } from './crud';
import type {
  ExcecaoReducao,
  ExcecaoReducaoCreate,
  RegraReducao,
  RegraReducaoCreate,
  RegraReducaoUpdate,
} from '../types/regraReducao';

const regraReducaoCrud = createCrudApi<RegraReducao, RegraReducaoCreate, RegraReducaoUpdate>(
  '/regras-reducao-produto',
);

export const regrasReducaoApi = {
  ...regraReducaoCrud,
  listar: async (params?: { perfil_id?: number; ncm?: string }): Promise<RegraReducao[]> => {
    const { data } = await apiClient.get<RegraReducao[]>('/regras-reducao-produto', { params });
    return data;
  },
  criarExcecao: async (regraId: number, payload: ExcecaoReducaoCreate): Promise<ExcecaoReducao> => {
    const { data } = await apiClient.post<ExcecaoReducao>(
      `/regras-reducao-produto/${regraId}/excecoes`,
      payload,
    );
    return data;
  },
  deletarExcecao: async (regraId: number, excecaoId: number): Promise<void> => {
    await apiClient.delete(`/regras-reducao-produto/${regraId}/excecoes/${excecaoId}`);
  },
};
