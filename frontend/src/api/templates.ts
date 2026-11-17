import { apiClient } from './client';
import type {
  TemplateAtivoResumo,
  TemplateSelectionConfig,
  TemplateXlsx,
} from '../types/template';

export type { TemplateAtivoResumo, TemplateSelectionConfig } from '../types/template';

export const templatesApi = {
  listar: async (params?: { tipo?: string; ativo?: boolean }): Promise<TemplateXlsx[]> => {
    const { data } = await apiClient.get<TemplateXlsx[]>('/templates', { params });
    return data;
  },
  listarConfiguracoesSelecao: async (): Promise<TemplateSelectionConfig[]> => {
    const { data } = await apiClient.get<TemplateSelectionConfig[]>('/templates/configuracoes-selecao');
    return data;
  },
  atualizarConfiguracaoSelecao: async (
    tipo: string,
    margemSegurancaLinhas: number,
  ): Promise<TemplateSelectionConfig> => {
    const { data } = await apiClient.put<TemplateSelectionConfig>(
      `/templates/configuracoes-selecao/${tipo}`,
      { margem_seguranca_linhas: margemSegurancaLinhas },
    );
    return data;
  },
  listarAtivosResumo: async (): Promise<TemplateAtivoResumo[]> => {
    const { data } = await apiClient.get<TemplateAtivoResumo[]>('/templates/ativos-resumo');
    return data;
  },
  obter: async (id: number): Promise<TemplateXlsx> => {
    const { data } = await apiClient.get<TemplateXlsx>(`/templates/${id}`);
    return data;
  },
  promover: async (id: number): Promise<TemplateXlsx> => {
    const { data } = await apiClient.post<TemplateXlsx>(`/templates/${id}/promover`);
    return data;
  },
  upload: async (formData: FormData): Promise<TemplateXlsx> => {
    const { data } = await apiClient.post<TemplateXlsx>('/templates/upload', formData);
    return data;
  },
};
