import { apiClient } from './client';
import { createCrudApi, createExcecoesApi } from './crud';
import type {
  ExcecaoFcp,
  ExcecaoFcpCreate,
  PresetBebidasBaResultado,
  RegraFcp,
  RegraFcpCreate,
  RegraFcpUpdate,
} from '../types/regraFcp';

const regraFcpCrud = createCrudApi<RegraFcp, RegraFcpCreate, RegraFcpUpdate>('/regras-fcp');
const regraFcpExcecoes = createExcecoesApi<ExcecaoFcp, ExcecaoFcpCreate>('/regras-fcp');

export const regrasFcpApi = {
  ...regraFcpCrud,
  ...regraFcpExcecoes,
  listar: async (params?: {
    perfil_id?: number;
    uf?: string;
    ncm?: string;
  }): Promise<RegraFcp[]> => {
    const { data } = await apiClient.get<RegraFcp[]>('/regras-fcp', { params });
    return data;
  },
  carregarPresetBebidasBa: async (perfilRegrasId: number): Promise<PresetBebidasBaResultado> => {
    const { data } = await apiClient.post<PresetBebidasBaResultado>(
      '/regras-fcp/preset-bebidas-ba',
      null,
      { params: { perfil_regras_id: perfilRegrasId } },
    );
    return data;
  },
};
