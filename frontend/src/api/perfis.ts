import { apiClient } from './client';
import { createCrudApi } from './crud';
import type {
  CopiarRegrasPayload,
  CopiarRegrasResultado,
  PerfilRegras,
  PerfilRegrasCreate,
  PerfilRegrasUpdate,
} from '../types/perfil';

const perfilCrud = createCrudApi<PerfilRegras, PerfilRegrasCreate, PerfilRegrasUpdate>('/perfis-regras');

export const perfisApi = {
  ...perfilCrud,
  duplicar: async (id: number, nome: string): Promise<PerfilRegras> => {
    const { data } = await apiClient.post<PerfilRegras>(`/perfis-regras/${id}/duplicar`, { nome });
    return data;
  },
  copiarRegras: async (id: number, payload: CopiarRegrasPayload): Promise<CopiarRegrasResultado> => {
    const { data } = await apiClient.post<CopiarRegrasResultado>(`/perfis-regras/${id}/copiar-regras`, payload);
    return data;
  },
  listar: async (): Promise<PerfilRegras[]> => {
    const { data } = await apiClient.get<PerfilRegras[]>('/perfis-regras');
    return data;
  },
};
