import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api/v1',
});

// Interceptor para injetar token JWT/Bearer e gerenciar headers dinâmicos
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

// Helper para extrair mensagem amigável de erro do backend
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.data?.detail) {
      const detail = error.response.data.detail;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail)) {
        return detail.map(getValidationDetailMessage).join(' | ');
      }
      return JSON.stringify(detail);
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Ocorreu um erro inesperado. Tente novamente.';
}

function getValidationDetailMessage(detail: unknown): string {
  if (
    typeof detail === 'object'
    && detail !== null
    && 'msg' in detail
    && typeof detail.msg === 'string'
  ) {
    return detail.msg;
  }
  return JSON.stringify(detail);
}
