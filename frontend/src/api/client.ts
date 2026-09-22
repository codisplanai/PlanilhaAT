import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { runtimeConfig } from '../lib/runtimeConfig';
import { createSessionRefresher, isSessionEndpoint, shouldAttemptRefresh } from '../lib/accessToken';
import type { LoginResponse, User } from '../types/auth';

const rawApiUrl = runtimeConfig.apiUrl || import.meta.env.VITE_API_URL || '';
const baseApiUrl = String(rawApiUrl).trim().replace(/\/+$/, '');

export const apiClient = axios.create({
  baseURL: baseApiUrl ? `${baseApiUrl}/api/v1` : '/api/v1',
  timeout: 120_000,
  // O refresh token viaja em cookie httpOnly; sem isto ele não acompanharia a
  // requisição de renovação.
  withCredentials: true,
});

/** Cliente sem interceptores: a renovação não pode se renovar recursivamente. */
const refreshClient = axios.create({
  baseURL: apiClient.defaults.baseURL,
  timeout: 30_000,
  withCredentials: true,
});

/**
 * O ``/auth/refresh`` devolve token e usuário juntos. Guardar o usuário aqui
 * deixa a restauração da sessão no boot custar uma requisição em vez de duas
 * (renovar e depois consultar ``/auth/me``).
 */
let usuarioRenovado: User | null = null;

export function getRefreshedUser(): User | null {
  return usuarioRenovado;
}

export const session = createSessionRefresher({
  refresh: async () => {
    const { data } = await refreshClient.post<LoginResponse>('/auth/refresh');
    usuarioRenovado = data.user;
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? null };
  },
  onSessionEnded: () => {
    usuarioRenovado = null;
    window.dispatchEvent(new Event('planilha-at:unauthorized'));
  },
});

type RetriableConfig = InternalAxiosRequestConfig & { _planautRetentado?: boolean };

apiClient.interceptors.request.use(async (config) => {
  if (!isSessionEndpoint(config.url)) {
    // Renova antes de enviar quando a expiração está próxima: evita o 401 no
    // meio de um processamento longo em vez de reagir a ele.
    await session.ensureFreshToken().catch(() => undefined);
  }

  const token = session.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.data instanceof FormData) {
    // ``delete headers['Content-Type']`` depende da grafia exata com que o
    // cabeçalho foi gravado; a API do AxiosHeaders remove em qualquer grafia e
    // deixa o navegador definir o boundary do multipart.
    config.headers.delete('Content-Type');
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as RetriableConfig | undefined;

    if (!shouldAttemptRefresh({
      status: error.response?.status,
      url: config?.url,
      alreadyRetried: Boolean(config?._planautRetentado),
    })) {
      // Um 401 que já passou por renovação significa sessão encerrada de fato.
      if (error.response?.status === 401 && !isSessionEndpoint(config?.url)) {
        window.dispatchEvent(new Event('planilha-at:unauthorized'));
      }
      return Promise.reject(error);
    }

    config!._planautRetentado = true;
    try {
      await session.refresh();
    } catch {
      // ``onSessionEnded`` já avisou a aplicação; devolve o erro original para
      // a tela continuar mostrando o motivo real da falha.
      return Promise.reject(error);
    }

    return apiClient(config!);
  }
);

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
      return 'O conjunto de arquivos excede o tamanho máximo permitido.';
    }
    if (error.response?.data?.detail) {
      const detail = error.response.data.detail;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail)) {
        return detail.map(getValidationDetailMessage).join(' | ');
      }
      // Um objeto solto já chegou à tela como JSON cru; extrair a mensagem
      // conhecida mantém o texto legível para quem está operando o sistema.
      return getValidationDetailMessage(detail);
    }
    if (error.code === 'ERR_NETWORK') {
      return 'Não foi possível contatar o servidor. Verifique sua conexão e tente novamente.';
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Ocorreu um erro inesperado. Tente novamente.';
}

function getValidationDetailMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object' && detail !== null) {
    for (const field of ['msg', 'detail', 'message'] as const) {
      const value = (detail as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return 'Ocorreu um erro inesperado. Tente novamente.';
}
