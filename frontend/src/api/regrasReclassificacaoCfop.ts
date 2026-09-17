import { apiClient } from './client';
import { createCrudApi } from './crud';
import type {
  ExcecaoReclassificacaoCfop,
  ExcecaoReclassificacaoCfopCreate,
  RegraReclassificacaoCfop,
  RegraReclassificacaoCfopCreate,
  RegraReclassificacaoCfopUpdate,
} from '../types/regraReclassificacaoCfop';

const regraReclassificacaoCrud = createCrudApi<
  RegraReclassificacaoCfop,
  RegraReclassificacaoCfopCreate,
  RegraReclassificacaoCfopUpdate
>('/regras-reclassificacao-cfop');

export const regrasReclassificacaoCfopApi = {
  ...regraReclassificacaoCrud,
  listar: async (params?: { perfil_id?: number; ncm?: string }): Promise<RegraReclassificacaoCfop[]> => {
    const { data } = await apiClient.get<RegraReclassificacaoCfop[]>('/regras-reclassificacao-cfop', {
      params,
    });
    return data;
  },
  criarExcecao: async (
    regraId: number,
    payload: ExcecaoReclassificacaoCfopCreate,
  ): Promise<ExcecaoReclassificacaoCfop> => {
    const { data } = await apiClient.post<ExcecaoReclassificacaoCfop>(
      `/regras-reclassificacao-cfop/${regraId}/excecoes`,
      payload,
    );
    return data;
  },
  deletarExcecao: async (regraId: number, excecaoId: number): Promise<void> => {
    await apiClient.delete(`/regras-reclassificacao-cfop/${regraId}/excecoes/${excecaoId}`);
  },
};
