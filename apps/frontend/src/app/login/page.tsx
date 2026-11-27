'use client';

import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import {
  Alert,
  Button,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { AuthErrorAlert } from '@/components/AuthErrorAlert';
import { AuthLink } from '@/components/AuthLink';
import { useAuth } from '@/components/AuthProvider';
import { accountHome } from '@/lib/account-home';

const subscribeNoop = () => () => {};
const readSearch = () => window.location.search;

/** Avisos que llegan por query desde los flujos de verificación y recuperación. */
function notice(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get('verified') === '1') return 'Tu correo quedó verificado. Ya podés iniciar sesión.';
  if (params.get('reset') === 'ok')
    return 'Actualizaste tu contraseña. Iniciá sesión con la nueva.';
  return null;
}

export default function LoginPage() {
  const { status, me, signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const info = notice(useSyncExternalStore(subscribeNoop, readSearch, () => ''));

  useEffect(() => {
    if (status === 'signedIn' && me) router.replace(accountHome(me));
  }, [status, me, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <Stack component="form" spacing={2.5} onSubmit={onSubmit}>
        <div>
          <Typography variant="h1">Iniciá sesión</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Ingresá con la cuenta de tu negocio.
          </Typography>
        </div>
        {info && !error && <Alert severity="success">{info}</Alert>}
        {error && <AuthErrorAlert>{error}</AuthErrorAlert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Contraseña"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    edge="end"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <Button type="submit" variant="contained" disabled={submitting || status === 'loading'}>
          {submitting ? 'Ingresando…' : 'Ingresar'}
        </Button>
        <Typography variant="body2" sx={{ textAlign: 'center' }}>
          <AuthLink href="/forgot-password">¿Olvidaste tu contraseña?</AuthLink>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
          ¿Te invitaron a TurnoSmart? <AuthLink href="/register">Creá tu cuenta</AuthLink> con el
          email de la invitación.
        </Typography>
      </Stack>
    </AuthLayout>
  );
}
