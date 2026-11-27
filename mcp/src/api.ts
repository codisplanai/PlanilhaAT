import type { PlanautMcpConfig } from './config.ts';

// O build da extensão grava aqui a versão da release do Planaut (esbuild define).
export const MCP_VERSION: string = process.env.PLANAUT_MCP_VERSION || '1.0.0';
const API_PREFIX = '/api/v1';
const REFRESH_COOKIE = 'planaut_refresh';
const DEFAULT_TIMEOUT_MS = 30_000;
/** Renova o token um pouco antes de expirar, em vez de descobrir pelo 401. */
const RENEW_MARGIN_MS = 60_000;

export interface PlanautUser {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  role?: string | null;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number | null;
  user: PlanautUser;
}

export class PlanautApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'PlanautApiError';
    this.status = status;
    this.detail = detail;
  }
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Envio multipart (upload de arquivo); exclusivo com `body`. */
  form?: FormData;
  timeoutMs?: number;
}

/** Converte o `detail` do FastAPI (texto ou lista de erros de validação) em uma frase. */
export function formatApiDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === 'object') {
          const record = item as { loc?: unknown[]; msg?: string };
          const loc = Array.isArray(record.loc)
            ? record.loc.filter((part) => part !== 'body' && part !== 'query').join('.')
            : '';
          return loc ? `${loc}: ${record.msg ?? 'valor inválido'}` : record.msg ?? JSON.stringify(item);
        }
        return String(item);
      })
      .join('; ');
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail);
  return '';
}

function readRefreshCookie(response: Response): string | null | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (response.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  for (const cookie of cookies) {
    const [pair, ...attributes] = cookie.split(';');
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    if (name !== REFRESH_COOKIE) continue;
    const value = pair.slice(separator + 1).trim().replace(/^"|"$/g, '');
    const expired = attributes.some((attr) => /^\s*max-age\s*=\s*0\s*$/i.test(attr));
    return value && !expired ? value : null;
  }
  return undefined;
}

/**
 * Cliente da API REST do Planaut com a sessão do usuário configurado.
 *
 * Usa exatamente o mesmo login do site (`/auth/login`), então as permissões
 * são as do perfil do usuário: o que um operador não pode fazer no site, a IA
 * também não consegue fazer por aqui.
 */
export class PlanautApi {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshToken: string | null = null;
  private pendingLogin: Promise<void> | null = null;
  user: PlanautUser | null = null;
  private readonly config: PlanautMcpConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PlanautMcpConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  private url(pathname: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${this.config.baseUrl}${API_PREFIX}${pathname}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async send(
    method: string,
    pathname: string,
    options: RequestOptions & { auth?: boolean; cookie?: string | null } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': `planaut-mcp/${MCP_VERSION}`,
    };
    // Com FormData o fetch define o Content-Type multipart com o boundary.
    if (options.body !== undefined && !options.form) headers['Content-Type'] = 'application/json';
    if (options.auth !== false && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if (options.cookie) headers.Cookie = `${REFRESH_COOKIE}=${options.cookie}`;
    try {
      return await this.fetchImpl(this.url(pathname, options.query), {
        method,
        headers,
        body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError'
        ? 'o servidor não respondeu a tempo'
        : error instanceof Error ? error.message : String(error);
      throw new PlanautApiError(0, `Não foi possível contactar o Planaut em ${this.config.baseUrl}: ${reason}.`);
    }
  }

  private async errorFrom(response: Response): Promise<PlanautApiError> {
    let detail: unknown;
    try {
      detail = (await response.json() as { detail?: unknown }).detail;
    } catch {
      detail = undefined;
    }
    const text = formatApiDetail(detail);
    const fallback: Record<number, string> = {
      401: 'Sessão do Planaut recusada. Verifique o e-mail e a senha configurados.',
      403: 'Seu usuário do Planaut não tem permissão para esta operação.',
      404: 'Registro não encontrado no Planaut.',
      413: 'Conteúdo maior que o limite aceito pelo Planaut.',
      503: 'O Planaut está temporariamente indisponível.',
    };
    return new PlanautApiError(
      response.status,
      text || fallback[response.status] || `O Planaut respondeu com erro HTTP ${response.status}.`,
      detail,
    );
  }

  /** JSON da resposta; HTML (endereço errado cai no site) vira erro explicável. */
  private async readJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PlanautApiError(
        response.status,
        `Resposta inesperada do Planaut em ${this.config.baseUrl} (não é JSON). Confira o endereço configurado.`,
      );
    }
  }

  private applyToken(data: TokenResponse, response: Response): void {
    if (!data || typeof data.access_token !== 'string') {
      throw new PlanautApiError(response.status, 'O Planaut não devolveu um token de acesso. Confira o endereço configurado.');
    }
    this.accessToken = data.access_token;
    const ttlMs = typeof data.expires_in === 'number' && data.expires_in > 0
      ? data.expires_in * 1000
      : 30 * 60 * 1000;
    this.expiresAt = Date.now() + ttlMs;
    this.user = data.user;
    const cookie = readRefreshCookie(response);
    if (cookie !== undefined) this.refreshToken = cookie;
  }

  async login(): Promise<void> {
    if (!this.config.email || !this.config.senha) {
      throw new PlanautApiError(
        401,
        'E-mail e senha do Planaut não configurados. Preencha-os nas configurações da extensão '
        + '(ou nas variáveis PLANAUT_EMAIL e PLANAUT_SENHA).',
      );
    }
    this.accessToken = null;
    const response = await this.send('POST', '/auth/login', {
      auth: false,
      body: { email: this.config.email, password: this.config.senha },
    });
    if (!response.ok) throw await this.errorFrom(response);
    this.applyToken(await this.readJson<TokenResponse>(response), response);
  }

  /** Tenta renovar pelo refresh token; devolve `false` se for preciso logar de novo. */
  private async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    const response = await this.send('POST', '/auth/refresh', { auth: false, cookie: this.refreshToken });
    if (!response.ok) {
      const cookie = readRefreshCookie(response);
      if (cookie !== undefined) this.refreshToken = cookie;
      if (response.status === 503) throw await this.errorFrom(response);
      return false;
    }
    this.applyToken(await this.readJson<TokenResponse>(response), response);
    return true;
  }

  private async renewSession(): Promise<void> {
    if (!this.pendingLogin) {
      this.pendingLogin = (async () => {
        if (!(await this.refresh())) await this.login();
      })().finally(() => {
        this.pendingLogin = null;
      });
    }
    await this.pendingLogin;
  }

  async ensureSession(): Promise<void> {
    if (this.accessToken && Date.now() < this.expiresAt - RENEW_MARGIN_MS) return;
    await this.renewSession();
  }

  private async authorized(method: string, pathname: string, options: RequestOptions = {}): Promise<Response> {
    await this.ensureSession();
    let response = await this.send(method, pathname, options);
    if (response.status === 401) {
      this.accessToken = null;
      await this.renewSession();
      response = await this.send(method, pathname, options);
    }
    if (!response.ok) throw await this.errorFrom(response);
    return response;
  }

  async request<T = unknown>(method: string, pathname: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.authorized(method, pathname, options);
    if (response.status === 204) return undefined as T;
    return this.readJson<T>(response);
  }

  get<T = unknown>(pathname: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('GET', pathname, { query });
  }

  post<T = unknown>(pathname: string, body?: unknown, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('POST', pathname, { ...options, body: body ?? {} });
  }

  postForm<T = unknown>(pathname: string, form: FormData, timeoutMs = 120_000): Promise<T> {
    return this.request<T>('POST', pathname, { form, timeoutMs });
  }

  put<T = unknown>(pathname: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', pathname, { body });
  }

  delete(pathname: string): Promise<void> {
    return this.request<void>('DELETE', pathname);
  }

  async getBytes(pathname: string, timeoutMs = 120_000): Promise<ArrayBuffer> {
    const response = await this.authorized('GET', pathname, { timeoutMs });
    return response.arrayBuffer();
  }

  async currentUser(): Promise<PlanautUser> {
    await this.ensureSession();
    if (!this.user) this.user = await this.get<PlanautUser>('/auth/me');
    return this.user;
  }
}

export function isAdminUser(user: PlanautUser | null): boolean {
  if (!user) return false;
  const role = String(user.role ?? '').toLowerCase().trim();
  const cargo = String(user.cargo ?? '').toLowerCase();
  return ['admin', 'administrador', 'senior'].includes(role) || cargo.includes('sênior') || cargo.includes('senior');
}
