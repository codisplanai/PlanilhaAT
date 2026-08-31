import { apiClient } from './client';
import { createCrudApi } from './crud';
import type { RegraCfop, RegraCfopCreate, RegraCfopUpdate, RegraCfopEfetiva } from '../types/regraCfop';

const regraCfopCrud = createCrudApi<RegraCfop, RegraCfopCreate, RegraCfopUpdate>('/regras-cfop');

export const regrasCfopApi = {
  ...regraCfopCrud,
  listar: async (params?: { perfil_id?: number; apenas_globais?: boolean }): Promise<RegraCfop[]> => {
    const { data } = await apiClient.get<RegraCfop[]>('/regras-cfop', { params });
    return data;
  },
  listarEfetivas: async (perfilId: number): Promise<RegraCfopEfetiva[]> => {
    const { data } = await apiClient.get<RegraCfopEfetiva[]>('/regras-cfop/efetivas', { params: { perfil_id: perfilId } });
    return data;
  },
};
