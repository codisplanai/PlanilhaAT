import { apiClient } from './client';
import { createCrudApi } from './crud';
import type { RegraAliquota, RegraAliquotaCreate, RegraAliquotaUpdate } from '../types/regra';

const regraCrud = createCrudApi<RegraAliquota, RegraAliquotaCreate, RegraAliquotaUpdate>('/regras-aliquotas');

export const regrasApi = {
  ...regraCrud,
  listar: async (params?: { perfil_id?: number; uf?: string; ncm?: string }): Promise<RegraAliquota[]> => {
    const { data } = await apiClient.get<RegraAliquota[]>('/regras-aliquotas', { params });
    return data;
  },
};
