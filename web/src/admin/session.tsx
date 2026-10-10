import { createContext, useContext, useEffect } from 'react';
import type { User } from '../lib/admin';
import { useLoad } from '../lib/useLoad';

export interface Session {
  user: User;
  logout: () => Promise<void>;
  /** La API respondió 401: la sesión venció */
  expired: () => void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession fuera del panel');
  return s;
}

/** useLoad para el panel: si la sesión vence, vuelve al login. */
export function useAdminLoad<T>(fetcher: () => Promise<T>, every = 30_000) {
  const { expired } = useSession();
  const state = useLoad(fetcher, every);
  useEffect(() => {
    if (state.error?.status === 401) expired();
  }, [state.error, expired]);
  return state;
}
