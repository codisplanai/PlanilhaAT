import { useCallback, useEffect, useState } from 'react';

import { authApi } from '../api/auth';
import {
  clearStoredSession,
  readAccessToken,
  readStoredUser,
  storeSession,
  storeUser,
} from '../lib/sessionStorage';
import type { User } from '../types/auth';

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(readStoredUser);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    let active = true;
    const validateSession = async () => {
      const token = readAccessToken();
      if (!token) {
        if (active) setIsInitializing(false);
        return;
      }

      try {
        const currentUser = await authApi.getMe();
        storeUser(currentUser);
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
    storeSession(nextUser, token);
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
