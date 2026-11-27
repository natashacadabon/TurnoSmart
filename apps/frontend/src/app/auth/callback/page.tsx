'use client';

import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';
import { nextAfterCallback, parseAuthCallback } from '@/lib/auth-flow.mjs';

// Los enlaces de correo siempre abren esta página con una carga completa. Se captura la URL al
// evaluar el módulo, antes de que el cliente de Supabase canjee el token y limpie el hash.
const CAPTURED = typeof window === 'undefined' ? null : parseAuthCallback(window.location.href);
const subscribeNoop = () => () => {};

/**
 * Destino de los enlaces de Supabase Auth (invitación, recuperación y verificación de correo).
 * Supabase canjea el token del hash; esta pantalla decide a dónde seguir o explica por qué el
 * enlace no sirve (vencido, ya usado o inválido).
 */
export default function AuthCallbackPage() {
  const { status } = useAuth();
  const router = useRouter();
  const parsed = useSyncExternalStore(
    subscribeNoop,
    () => CAPTURED,
    () => null,
  );
  // Sin sesión después de procesar el enlace: el token no era válido. Verificar el correo no
  // exige sesión, así que en ese caso se sigue al login.
  const failed =
    parsed !== null &&
    (parsed.error !== null || (status === 'signedOut' && parsed.flow !== 'verify'));

  useEffect(() => {
    if (!parsed || failed) return;
    if (status === 'signedIn' || (status === 'signedOut' && parsed.flow === 'verify'))
      router.replace(nextAfterCallback(parsed.flow));
  }, [parsed, failed, status, router]);

  if (parsed && failed) {
    const expired = parsed.error?.expired ?? false;
    return (
      <AuthLayout>
        <Stack spacing={2.5} data-testid="auth-link-error">
          <Typography variant="h1">
            {expired ? 'El enlace venció' : 'El enlace no es válido'}
          </Typography>
          <Alert severity="warning">
            {parsed.flow === 'invite'
              ? 'Pedile al administrador de la plataforma que te reenvíe la invitación.'
              : 'Los enlaces se pueden usar una sola vez y vencen en una hora. Pedí uno nuevo.'}
          </Alert>
          {parsed.flow !== 'invite' && (
            <Button component={Link} href="/forgot-password" variant="contained">
              Pedir un enlace nuevo
            </Button>
          )}
          <Button component={Link} href="/login">
            Ir a iniciar sesión
          </Button>
        </Stack>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Stack spacing={2} sx={{ alignItems: 'center', py: 2 }}>
        <CircularProgress aria-label="Validando enlace" />
        <Typography color="text.secondary">Validando el enlace…</Typography>
      </Stack>
    </AuthLayout>
  );
}
