import { apiClient } from './client';

export function createCrudApi<Entity, CreatePayload, UpdatePayload>(basePath: string) {
  return {
    obter: async (id: number): Promise<Entity> => {
      const { data } = await apiClient.get<Entity>(`${basePath}/${id}`);
      return data;
    },
    criar: async (payload: CreatePayload): Promise<Entity> => {
      const { data } = await apiClient.post<Entity>(basePath, payload);
      return data;
    },
    atualizar: async (id: number, payload: UpdatePayload): Promise<Entity> => {
      const { data } = await apiClient.put<Entity>(`${basePath}/${id}`, payload);
      return data;
    },
    deletar: async (id: number): Promise<void> => {
      await apiClient.delete(`${basePath}/${id}`);
    },
  };
}
