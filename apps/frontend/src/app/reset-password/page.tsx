'use client';

import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import {
  Alert,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';
import { accountHome } from '@/lib/account-home';
import { PASSWORD_MIN_LENGTH, validateNewPassword } from '@/lib/auth-flow.mjs';

const subscribeNoop = () => () => {};
const readInvite = () => new URLSearchParams(window.location.search).get('flow') === 'invite';

/**
 * Nueva contraseña para una sesión abierta por un enlace de invitación (primer acceso del OWNER)
 * o de recuperación. Sin esa sesión el enlace no era válido y se ofrece pedir otro.
 */
export default function ResetPasswordPage() {
  const { status, updatePassword } = useAuth();
  const router = useRouter();
  const invite = useSyncExternalStore(subscribeNoop, readInvite, () => false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const invalid = validateNewPassword(password, confirmation);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const me = await updatePassword(password);
      router.replace(me ? accountHome(me) : '/login?reset=ok');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la contraseña');
      setSubmitting(false);
    }
  }

  if (status === 'loading')
    return (
      <AuthLayout>
        <Stack sx={{ alignItems: 'center', py: 2 }}>
          <CircularProgress aria-label="Cargando" />
        </Stack>
      </AuthLayout>
    );

  if (status === 'signedOut')
    return (
      <AuthLayout>
        <Stack spacing={2.5} data-testid="reset-no-session">
          <Typography variant="h1">El enlace no es válido</Typography>
          <Alert severity="warning">
            Para cambiar la contraseña abrí el enlace más reciente que te enviamos por correo.
          </Alert>
          <Button component={Link} href="/forgot-password" variant="contained">
            Pedir un enlace nuevo
          </Button>
        </Stack>
      </AuthLayout>
    );

  const visibility = {
    input: {
      endAdornment: (
        <InputAdornment position="end">
          <IconButton
            edge="end"
            aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            onClick={() => setShow((v) => !v)}
          >
            {show ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
          </IconButton>
        </InputAdornment>
      ),
    },
  };

  return (
    <AuthLayout>
      <Stack component="form" spacing={2.5} onSubmit={onSubmit}>
        <div>
          {invite && (
            <Typography variant="overline" color="primary">
              Bienvenida/o a TurnoSmart
            </Typography>
          )}
          <Typography variant="h1">
            {invite ? 'Creá tu contraseña' : 'Definí una nueva contraseña'}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Al menos {PASSWORD_MIN_LENGTH} caracteres, combinando letras y números.
          </Typography>
        </div>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Nueva contraseña"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          slotProps={visibility}
        />
        <TextField
          label="Repetí la contraseña"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
        <Button type="submit" variant="contained" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Guardar contraseña'}
        </Button>
      </Stack>
    </AuthLayout>
  );
}
