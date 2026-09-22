import { useCallback, useEffect, useState } from 'react';

import { authApi } from '../api/auth';
import { session } from '../api/client';
import {
  clearStoredSession,
  readStoredUser,
  storeUser,
} from '../lib/sessionStorage';
import type { User } from '../types/auth';

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  /**
   * O access token vive em memória e some a cada recarga. A sessão é
   * reconstruída pelo cookie httpOnly: uma renovação no boot devolve token e
   * usuário de uma vez — o mesmo número de requisições do ``/auth/me`` que
   * havia antes.
   */
  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      try {
        const currentUser = await authApi.refresh();
        if (!active) return;
        storeUser(currentUser);
        setUser(currentUser);
      } catch {
        // Sem cookie válido não há sessão a restaurar; segue para o login.
        clearStoredSession();
        if (active) setUser(null);
      } finally {
        if (active) setIsInitializing(false);
      }
    };

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      session.clearSession();
      clearStoredSession();
      setUser(null);
    };
    window.addEventListener('planilha-at:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('planilha-at:unauthorized', handleUnauthorized);
  }, []);

  /**
   * ``localStorage`` é compartilhado entre as abas do mesmo domínio. Sem ouvir
   * ``storage``, sair em uma aba deixava as demais exibindo a interface
   * autenticada, e entrar com outro usuário deixava o perfil anterior em tela.
   */
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== null && event.key !== 'user') return;

      const stored = readStoredUser();
      if (!stored) {
        session.clearSession();
        setUser(null);
        return;
      }
      setUser(stored);
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const startSession = useCallback((nextUser: User, token: string, expiresIn: number | null) => {
    session.setSession(token, expiresIn);
    storeUser(nextUser);
    setUser(nextUser);
  }, []);

  const endSession = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // O encerramento local continua mesmo se o servidor estiver indisponível.
    } finally {
      session.clearSession();
      clearStoredSession();
      setUser(null);
    }
  }, []);

  return { user, isInitializing, startSession, endSession };
}
