import { apiClient } from './client';
import { createCrudApi, createExcecoesApi } from './crud';
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
const regraReclassificacaoExcecoes = createExcecoesApi<
  ExcecaoReclassificacaoCfop,
  ExcecaoReclassificacaoCfopCreate
>('/regras-reclassificacao-cfop');

export const regrasReclassificacaoCfopApi = {
  ...regraReclassificacaoCrud,
  ...regraReclassificacaoExcecoes,
  listar: async (params?: { perfil_id?: number; ncm?: string }): Promise<RegraReclassificacaoCfop[]> => {
    const { data } = await apiClient.get<RegraReclassificacaoCfop[]>('/regras-reclassificacao-cfop', {
      params,
    });
    return data;
  },
};
