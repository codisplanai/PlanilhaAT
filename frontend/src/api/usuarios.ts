import { apiClient } from './client';
import type { Usuario, UsuarioCreatePayload } from '../types/usuario';

export const usuariosApi = {
  listar: async (): Promise<Usuario[]> => {
    const { data } = await apiClient.get<Usuario[]>('/usuarios');
    return data;
  },
  criar: async (payload: UsuarioCreatePayload): Promise<Usuario> => {
    const { data } = await apiClient.post<Usuario>('/usuarios', payload);
    return data;
  },
  alterarStatus: async (id: string, ativo: boolean): Promise<Usuario> => {
    const { data } = await apiClient.patch<Usuario>(`/usuarios/${id}/status`, { ativo });
    return data;
  },
};
