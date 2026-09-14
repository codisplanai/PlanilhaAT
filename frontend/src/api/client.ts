import axios from 'axios';

const rawApiUrl = import.meta.env.VITE_API_URL || '';
const baseApiUrl = String(rawApiUrl).trim().replace(/\/+$/, '');

export const apiClient = axios.create({
  baseURL: baseApiUrl ? `${baseApiUrl}/api/v1` : '/api/v1',
  timeout: 120_000,
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = String(error.config?.url || '').includes('/auth/login');
    if (error.response?.status === 401 && !isLoginRequest) {
      window.dispatchEvent(new Event('planilha-at:unauthorized'));
    }
    return Promise.reject(error);
  }
);

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
    if (error.code === 'ECONNABORTED' || (typeof error.message === 'string' && error.message.toLowerCase().includes('timeout'))) {
      return 'O processamento demorou mais que o esperado (tempo limite excedido). Tente novamente.';
    }
    if (error.response?.status === 413) {
      const detail = error.response.data?.detail;
      if (detail) {
        if (typeof detail === 'string') return detail;
        if (Array.isArray(detail)) return detail.map(getValidationDetailMessage).join(' | ');
      }
      return 'O conjunto de arquivos enviados excede o tamanho máximo permitido pelo servidor.';
    }
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
