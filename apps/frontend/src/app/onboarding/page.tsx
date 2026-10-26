'use client';

import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import type { MeResponse, OnboardingRequest } from '@turnosmart/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { DEFAULT_TIMEZONE, detectTimezone, timezoneLabel } from '@/lib/timezones';

const subscribeNoop = () => () => {};

export default function OnboardingPage() {
  const { status, me, refreshMe, signOut } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ businessName: '', fullName: '' });
  // Se detecta en el cliente; en el prerender del servidor se usa la de Argentina.
  const timezone = useSyncExternalStore(subscribeNoop, detectTimezone, () => DEFAULT_TIMEZONE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    if (me?.onboarded) router.replace('/customers');
  }, [status, me, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    setError(null);
    try {
      const body: OnboardingRequest = {
        businessName: form.businessName,
        timezone,
        ...(form.fullName.trim() ? { fullName: form.fullName } : {}),
      };
      await api<MeResponse>('/api/onboarding', { method: 'POST', body });
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
      <Stack component="form" spacing={2.5} onSubmit={onSubmit}>
        <div>
          <Typography variant="overline" color="primary">
            Último paso
          </Typography>
          <Typography variant="h1">Configurá tu negocio</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Tu cuenta todavía no tiene un negocio asociado. Vas a quedar como dueño/a.
          </Typography>
        </div>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Nombre del negocio"
          placeholder="Ej.: Peluquería Sol"
          required
          autoFocus
          value={form.businessName}
          error={!!errors.businessName}
          helperText={errors.businessName}
          onChange={(e) => setForm({ ...form, businessName: e.target.value })}
        />
        <TextField
          label="Tu nombre (opcional)"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
        />
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: 'flex-start', p: 1.5, borderRadius: 2.5, bgcolor: 'action.hover' }}
        >
          <PublicRoundedIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.25 }} />
          <Typography variant="body2" color="text.secondary">
            Horarios en{' '}
            <Box component="strong" sx={{ color: 'text.primary' }}>
              {timezoneLabel(timezone)}
            </Box>
            , según tu dispositivo. Podés cambiarlo después en Negocio.
          </Typography>
        </Stack>
        <Button type="submit" variant="contained" disabled={submitting}>
          {submitting ? 'Creando…' : 'Crear negocio'}
        </Button>
        <Button
          onClick={signOut}
          color="inherit"
          sx={{ alignSelf: 'center', color: 'text.secondary' }}
        >
          Salir y usar otra cuenta
        </Button>
      </Stack>
    </AuthLayout>
  );
}
