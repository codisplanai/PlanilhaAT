import { apiClient } from './client';
import type { TemplateXlsx } from '../types/template';

export interface TemplateAtivoResumo {
  id: number;
  tipo: string;
  versao: number;
  capacidade_linhas: number | null;
  criado_em: string | null;
  observacoes: string | null;
}

export const templatesApi = {
  listar: async (params?: { tipo?: string; ativo?: boolean }): Promise<TemplateXlsx[]> => {
    const { data } = await apiClient.get<TemplateXlsx[]>('/templates', { params });
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
