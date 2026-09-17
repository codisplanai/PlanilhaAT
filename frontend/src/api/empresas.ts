import { apiClient } from './client';
import { createCrudApi } from './crud';
import type { Empresa, EmpresaCreate, EmpresaUpdate, TermoAcordo } from '../types/empresa';

const empresaCrud = createCrudApi<Empresa, EmpresaCreate, EmpresaUpdate>('/empresas');

export const empresasApi = {
  ...empresaCrud,
  listar: async (params?: { uf?: string; perfil_id?: number }): Promise<Empresa[]> => {
    const { data } = await apiClient.get<Empresa[]>('/empresas', { params });
    return data;
  },
  definirTermoAcordo: async (
    empresaId: number,
    payload: { aliquota: number; descricao?: string | null },
  ): Promise<TermoAcordo> => {
    const { data } = await apiClient.put<TermoAcordo>(
      `/empresas/${empresaId}/termo-acordo`,
      payload,
    );
    return data;
  },
  removerTermoAcordo: async (empresaId: number): Promise<void> => {
    await apiClient.delete(`/empresas/${empresaId}/termo-acordo`);
  },
};
