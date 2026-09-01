import { useCallback, useEffect, useState } from 'react';

import { authApi } from '../api/auth';
import type { User } from '../types/auth';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

function readStoredUser(): User | null {
  const serialized = localStorage.getItem(USER_KEY);
  if (!serialized) return null;

  try {
    return JSON.parse(serialized) as User;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(readStoredUser);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    let active = true;
    const validateSession = async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        if (active) setIsInitializing(false);
        return;
      }

      try {
        const currentUser = await authApi.getMe();
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
        if (active) setUser(currentUser);
      } catch {
        clearStoredSession();
        if (active) setUser(null);
      } finally {
        if (active) setIsInitializing(false);
      }
    };

    void validateSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearStoredSession();
      setUser(null);
    };
    window.addEventListener('planilha-at:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('planilha-at:unauthorized', handleUnauthorized);
  }, []);

  const startSession = useCallback((nextUser: User, token: string) => {
    clearStoredSession();
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const endSession = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // O encerramento local continua mesmo se o servidor estiver indisponível.
    } finally {
      clearStoredSession();
      setUser(null);
    }
  }, []);

  return { user, isInitializing, startSession, endSession };
}

function clearStoredSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
