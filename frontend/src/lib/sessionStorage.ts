import type { User } from '../types/auth';

/**
 * Persistência local do usuário exibido na interface.
 *
 * Credenciais não passam mais por aqui: o access token vive em memória
 * (``lib/accessToken.ts``) e o refresh token em cookie httpOnly. O que resta é
 * dado de exibição — nome, cargo, papel — usado para pintar a tela sem esperar
 * a renovação inicial e para sincronizar as abas.
 */

const USER_KEY = 'user';

export function readStoredUser(): User | null {
  const serialized = localStorage.getItem(USER_KEY);
  if (!serialized) return null;

  try {
    return JSON.parse(serialized) as User;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function storeUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredSession(): void {
  localStorage.removeItem(USER_KEY);
  // Resquício das versões que guardavam a credencial no navegador. Removido no
  // logout para que um token antigo não fique esquecido no dispositivo.
  localStorage.removeItem('token');
}
