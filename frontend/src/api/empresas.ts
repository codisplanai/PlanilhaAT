import { apiClient } from './client';
import { createCrudApi } from './crud';
import type { Empresa, EmpresaCreate, EmpresaUpdate } from '../types/empresa';

const empresaCrud = createCrudApi<Empresa, EmpresaCreate, EmpresaUpdate>('/empresas');

export const empresasApi = {
  ...empresaCrud,
  listar: async (params?: { uf?: string; perfil_id?: number }): Promise<Empresa[]> => {
    const { data } = await apiClient.get<Empresa[]>('/empresas', { params });
    return data;
  },
};
