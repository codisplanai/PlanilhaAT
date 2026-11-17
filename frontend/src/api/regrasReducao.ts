import { apiClient } from './client';
import { createCrudApi, createExcecoesApi } from './crud';
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
const regraReducaoExcecoes = createExcecoesApi<ExcecaoReducao, ExcecaoReducaoCreate>(
  '/regras-reducao-produto',
);

export const regrasReducaoApi = {
  ...regraReducaoCrud,
  ...regraReducaoExcecoes,
  listar: async (params?: { perfil_id?: number; ncm?: string }): Promise<RegraReducao[]> => {
    const { data } = await apiClient.get<RegraReducao[]>('/regras-reducao-produto', { params });
    return data;
  },
};
