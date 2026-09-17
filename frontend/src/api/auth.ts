import { apiClient } from './client';
import type { AlterarSenhaPayload, LoginCredentials, LoginResponse, User } from '../types/auth';

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const { data } = await apiClient.post<LoginResponse>('/auth/login', credentials);
    return data;
  },
  getMe: async (): Promise<User> => {
    const { data } = await apiClient.get<User>('/auth/me');
    return data;
  },
  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
  },
  alterarSenha: async (payload: AlterarSenhaPayload): Promise<{ message: string }> => {
    const { data } = await apiClient.post<{ message: string }>('/auth/alterar-senha', payload);
    return data;
  },
};

