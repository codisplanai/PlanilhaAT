import { apiClient } from './client';
import { createCrudApi } from './crud';
import type { PerfilRegras, PerfilRegrasCreate, PerfilRegrasUpdate } from '../types/perfil';

const perfilCrud = createCrudApi<PerfilRegras, PerfilRegrasCreate, PerfilRegrasUpdate>('/perfis-regras');

export const perfisApi = {
  ...perfilCrud,
  listar: async (): Promise<PerfilRegras[]> => {
    const { data } = await apiClient.get<PerfilRegras[]>('/perfis-regras');
    return data;
  },
};
