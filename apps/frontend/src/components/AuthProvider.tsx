'use client';

import type { Session } from '@supabase/supabase-js';
import type { MeResponse } from '@turnosmart/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  session: Session | null;
  me: MeResponse | null;
  /** Error al resolver la cuenta (/api/me) con una sesión válida: API o base de datos caídas. */
  meError: string | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  refreshMe(): Promise<MeResponse | null>;
}

type MeResult =
  { kind: 'ok'; me: MeResponse } | { kind: 'error'; message: string } | { kind: 'unauthorized' };

const AuthContext = createContext<AuthValue | null>(null);

async function fetchMe(): Promise<MeResult> {
  try {
    return { kind: 'ok', me: await api<MeResponse>('/api/me') };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return { kind: 'unauthorized' };
    return { kind: 'error', message: errorMessage(err) };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  // Sin variables de Supabase no hay sesión posible; las páginas públicas (/) siguen funcionando.
  const [status, setStatus] = useState<Status>(() =>
    isSupabaseConfigured() ? 'loading' : 'signedOut',
  );

  const clearSession = useCallback(() => {
    setMe(null);
    setMeError(null);
    setSession(null);
    setStatus('signedOut');
  }, []);

  /** Resuelve la cuenta. Si el backend rechaza el token (vencido o usuario eliminado), cierra la sesión local. */
  const loadMe = useCallback(async (): Promise<MeResult> => {
    const result = await fetchMe();
    if (result.kind === 'ok') {
      setMe(result.me);
      setMeError(null);
    } else if (result.kind === 'error') {
      setMe(null);
      setMeError(result.message);
    } else {
      await getSupabase().auth.signOut({ scope: 'local' });
      clearSession();
    }
    return result;
  }, [clearSession]);

  const refreshMe = useCallback(async () => {
    const result = await loadMe();
    return result.kind === 'ok' ? result.me : null;
  }, [loadMe]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabase();
    let active = true;

    // Recuperación de sesión al recargar la página.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        setStatus('signedOut');
        return;
      }
      setSession(data.session);
      const result = await loadMe();
      if (active && result.kind !== 'unauthorized') setStatus('signedIn');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_OUT') {
        setMe(null);
        setMeError(null);
        setStatus('signedOut');
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadMe]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
      if (error)
        throw new Error(
          error.message === 'Invalid login credentials'
            ? 'Email o contraseña incorrectos'
            : error.message,
        );
      setSession(data.session);
      // La cuenta se resuelve antes de marcar la sesión, para redirigir directo a onboarding o clientes.
      const result = await loadMe();
      if (result.kind === 'unauthorized') {
        throw new Error('El servidor rechazó la sesión. Intentá de nuevo.');
      }
      setStatus('signedIn');
    },
    [loadMe],
  );

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    // Si Supabase no responde, igual se borra la sesión guardada en el navegador.
    const { error } = await supabase.auth.signOut().catch((e: unknown) => ({ error: e }));
    if (error) await supabase.auth.signOut({ scope: 'local' });
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({ status, session, me, meError, signIn, signOut, refreshMe }),
    [status, session, me, meError, signIn, signOut, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
