import { apiClient } from './client';
import { createCrudApi } from './crud';
import type { PerfilRegras, PerfilRegrasCreate, PerfilRegrasUpdate } from '../types/perfil';

const perfilCrud = createCrudApi<PerfilRegras, PerfilRegrasCreate, PerfilRegrasUpdate>('/perfis-regras');

export const perfisApi = {
  ...perfilCrud,
  duplicar: async (id: number, nome: string): Promise<PerfilRegras> => {
    const { data } = await apiClient.post<PerfilRegras>(`/perfis-regras/${id}/duplicar`, { nome });
    return data;
  },
  listar: async (): Promise<PerfilRegras[]> => {
    const { data } = await apiClient.get<PerfilRegras[]>('/perfis-regras');
    return data;
  },
};
