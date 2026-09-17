import { apiClient } from './client';
import { createCrudApi } from './crud';
import type {
  CargaPadraoBAResponse,
  RegraExclusaoParcial,
  RegraExclusaoParcialCreate,
  RegraExclusaoParcialUpdate,
} from '../types/regraExclusaoParcial';

const regraExclusaoCrud = createCrudApi<
  RegraExclusaoParcial,
  RegraExclusaoParcialCreate,
  RegraExclusaoParcialUpdate
>('/regras-exclusao-parcial');

export const regrasExclusaoParcialApi = {
  ...regraExclusaoCrud,
  listar: async (params?: {
    perfil_id?: number;
    uf?: string;
    ncm?: string;
    ativo?: boolean;
  }): Promise<RegraExclusaoParcial[]> => {
    const { data } = await apiClient.get<RegraExclusaoParcial[]>('/regras-exclusao-parcial', {
      params,
    });
    return data;
  },
  carregarPadraoBahia: async (perfil_regras_id: number): Promise<CargaPadraoBAResponse> => {
    const { data } = await apiClient.post<CargaPadraoBAResponse>(
      '/regras-exclusao-parcial/carregar-padrao-ba',
      { perfil_regras_id },
    );
    return data;
  },
};
