import { useEffect, useState } from 'react';

import { authApi } from '../api/auth';
import { supabase } from '../lib/supabase';
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
    const validateSession = async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        setIsInitializing(false);
        return;
      }

      try {
        const currentUser = await authApi.getMe();
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
        setUser(currentUser);
      } catch {
        clearStoredSession();
        setUser(null);
      } finally {
        setIsInitializing(false);
      }
    };

    void validateSession();
  }, []);

  const startSession = (nextUser: User, token?: string) => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  };

  const endSession = async () => {
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore supabase signout error
      }
    }
    clearStoredSession();
    setUser(null);
  };

  return { user, isInitializing, startSession, endSession };
}

function clearStoredSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
