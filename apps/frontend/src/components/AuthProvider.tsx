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
import { authCallbackUrl, authErrorMessage } from '@/lib/auth-flow.mjs';
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
  /** Envía el correo de recuperación. No revela si la cuenta existe. */
  requestPasswordReset(email: string): Promise<void>;
  /** Registro público: crea la cuenta y envía el correo de verificación. No revela si ya existía. */
  signUp(email: string, password: string): Promise<void>;
  /**
   * Define la contraseña de la sesión abierta por un enlace de invitación o recuperación y
   * devuelve la cuenta resuelta (null si la API no respondió).
   */
  updatePassword(password: string): Promise<MeResponse | null>;
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
      if (error) throw new Error(authErrorMessage(error));
      setSession(data.session);
      // La cuenta se resuelve antes de marcar la sesión, para redirigir directo a su pantalla.
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

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabase().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: authCallbackUrl(window.location.origin, 'verify') },
    });
    if (error) throw new Error(authErrorMessage(error));
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: authCallbackUrl(window.location.origin, 'recovery'),
    });
    // Una cuenta inexistente no es un error visible: sólo se informan límites y fallas del servicio.
    if (error && (error.status === 429 || (error.status ?? 500) >= 500))
      throw new Error(authErrorMessage(error));
  }, []);

  const updatePassword = useCallback(
    async (password: string) => {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) throw new Error(authErrorMessage(error));
      const result = await loadMe();
      if (result.kind === 'unauthorized') throw new Error(authErrorMessage(null));
      setStatus('signedIn');
      return result.kind === 'ok' ? result.me : null;
    },
    [loadMe],
  );

  const value = useMemo(
    () => ({
      status,
      session,
      me,
      meError,
      signIn,
      signOut,
      refreshMe,
      requestPasswordReset,
      signUp,
      updatePassword,
    }),
    [
      status,
      session,
      me,
      meError,
      signIn,
      signOut,
      refreshMe,
      requestPasswordReset,
      updatePassword,
      signUp,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
