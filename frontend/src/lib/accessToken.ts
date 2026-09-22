/**
 * Sessão em memória e coordenação da renovação.
 *
 * O access token deixou de viver no ``localStorage``: ele fica aqui, no escopo
 * do módulo, e o refresh token mora em cookie httpOnly que o JavaScript não
 * alcança. Um XSS passa a roubar, no pior caso, uma credencial de uma hora em
 * vez da sessão inteira.
 *
 * O módulo não conhece axios nem o DOM — é lógica pura, exercitada por testes.
 */

export interface RefreshResult {
  accessToken: string;
  expiresIn: number | null;
}

export interface SessionRefresherOptions {
  /** Executa a chamada de renovação. O cookie viaja sozinho na requisição. */
  refresh: () => Promise<RefreshResult>;
  /** Chamado uma única vez quando a sessão se encerra de vez. */
  onSessionEnded: () => void;
  now?: () => number;
  /** Antecedência da renovação proativa, em segundos. */
  skewSeconds?: number;
}

export interface SessionRefresher {
  getAccessToken(): string | null;
  setSession(token: string, expiresInSeconds: number | null): void;
  clearSession(): void;
  /** Renova agora. Chamadas concorrentes compartilham a mesma requisição. */
  refresh(): Promise<string>;
  /** Renova só se a expiração estiver próxima; devolve o token utilizável. */
  ensureFreshToken(): Promise<string | null>;
}

const DEFAULT_SKEW_SECONDS = 60;

/** Rotas que gerenciam a própria sessão e nunca devem disparar renovação. */
const SESSION_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

export function isSessionEndpoint(url: string | undefined): boolean {
  const alvo = String(url || '');
  return SESSION_PATHS.some((path) => alvo.includes(path));
}

/**
 * Decide se um erro merece renovar a sessão e repetir a requisição.
 *
 * Isolado em função pura porque é onde mora o risco de laço infinito: um 401
 * que persiste depois da renovação repetiria a requisição para sempre se a
 * marca de tentativa não fosse respeitada.
 */
export function shouldAttemptRefresh(params: {
  status: number | undefined;
  url: string | undefined;
  alreadyRetried: boolean;
}): boolean {
  if (params.status !== 401) return false;
  if (params.alreadyRetried) return false;
  return !isSessionEndpoint(params.url);
}

export function createSessionRefresher(options: SessionRefresherOptions): SessionRefresher {
  const now = options.now ?? (() => Date.now());
  const skewMs = (options.skewSeconds ?? DEFAULT_SKEW_SECONDS) * 1000;

  let accessToken: string | null = null;
  let expiresAt: number | null = null;
  let emVoo: Promise<string> | null = null;

  function setSession(token: string, expiresInSeconds: number | null): void {
    accessToken = token;
    // O fallback local emite token opaco sem prazo: sem expiração conhecida,
    // não há renovação proativa a fazer.
    expiresAt = expiresInSeconds === null ? null : now() + expiresInSeconds * 1000;
  }

  function clearSession(): void {
    accessToken = null;
    expiresAt = null;
  }

  function refresh(): Promise<string> {
    // Uma requisição por vez: o Supabase rotaciona o refresh token e trata
    // reuso como incidente, derrubando a família inteira de tokens. Várias
    // renovações em paralelo apresentariam o mesmo token mais de uma vez.
    if (emVoo) return emVoo;

    emVoo = options.refresh()
      .then((resultado) => {
        setSession(resultado.accessToken, resultado.expiresIn);
        return resultado.accessToken;
      })
      .catch((erro) => {
        clearSession();
        options.onSessionEnded();
        throw erro;
      })
      .finally(() => {
        // Liberar a referência é o que permite uma nova tentativa depois de
        // uma falha; retê-la deixaria a sessão presa no último erro.
        emVoo = null;
      });

    return emVoo;
  }

  function ensureFreshToken(): Promise<string | null> {
    if (emVoo) return emVoo;
    if (!accessToken) return Promise.resolve(null);
    if (expiresAt === null) return Promise.resolve(accessToken);
    if (now() < expiresAt - skewMs) return Promise.resolve(accessToken);
    return refresh();
  }

  return {
    getAccessToken: () => accessToken,
    setSession,
    clearSession,
    refresh,
    ensureFreshToken,
  };
}
