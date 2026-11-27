'use client';

import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import type { MeResponse } from '@turnosmart/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';
import { api, errorMessage, fieldErrors } from '@/lib/api';

export default function OnboardingPage() {
  const { status, me, refreshMe, signOut } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ token: '', fullName: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    if (me?.platformAdmin) router.replace('/admin');
    if (me?.onboarded) router.replace('/customers');
  }, [status, me, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    setError(null);
    try {
      await api<MeResponse>('/api/admin/owner-invitations/accept', {
        method: 'POST',
        body: { token: form.token, ...(form.fullName.trim() ? { fullName: form.fullName } : {}) },
      });
      await refreshMe();
      router.replace('/customers');
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      {me?.accountDisabled ? (
        <Stack spacing={2.5}>
          <div>
            <Typography variant="overline" color="error">
              Cuenta desactivada
            </Typography>
            <Typography variant="h1">Acceso temporalmente bloqueado</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Tu acceso al negocio {me.business.name} está desactivado. Contactá al administrador de
              la plataforma para volver a habilitarlo.
            </Typography>
          </div>
          <Alert severity="warning">
            No podés aceptar otra invitación mientras tu cuenta actual siga desactivada.
          </Alert>
          <Button onClick={signOut} variant="outlined" sx={{ alignSelf: 'center' }}>
            Salir
          </Button>
        </Stack>
      ) : (
        <Stack component="form" spacing={2.5} onSubmit={onSubmit}>
          <div>
            <Typography variant="overline" color="primary">
              Invitación de OWNER
            </Typography>
            <Typography variant="h1">Unirte a un negocio</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Ingresá el token que te entregó el administrador de la plataforma. El negocio y tu rol
              OWNER ya están definidos por esa invitación.
            </Typography>
          </div>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Token de invitación"
            placeholder="Pegá el token recibido"
            required
            autoFocus
            value={form.token}
            error={!!errors.token}
            helperText={errors.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            slotProps={{
              input: { startAdornment: <KeyRoundedIcon sx={{ mr: 1, color: 'text.secondary' }} /> },
            }}
          />
          <TextField
            label="Tu nombre (opcional)"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? 'Validando…' : 'Aceptar invitación'}
          </Button>
          <Button
            onClick={signOut}
            color="inherit"
            sx={{ alignSelf: 'center', color: 'text.secondary' }}
          >
            Salir y usar otra cuenta
          </Button>
        </Stack>
      )}
    </AuthLayout>
  );
}
