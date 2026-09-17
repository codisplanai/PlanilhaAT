import type { User } from '../types/auth';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export function readAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

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

export function storeSession(user: User, token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function storeUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
