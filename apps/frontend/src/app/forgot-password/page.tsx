'use client';

import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';

/** Solicitud de recuperación de contraseña. Siempre responde igual para no revelar cuentas. */
export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el correo');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <Stack component="form" spacing={2.5} onSubmit={onSubmit}>
        <div>
          <Typography variant="h1">Recuperá tu contraseña</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Te enviamos un enlace para definir una nueva. Vence en una hora.
          </Typography>
        </div>
        {sent ? (
          <Alert severity="success" data-testid="reset-sent">
            Si el correo corresponde a una cuenta activa, vas a recibir el enlace en unos minutos.
            Revisá también la carpeta de spam.
          </Alert>
        ) : (
          <>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? 'Enviando…' : 'Enviar enlace'}
            </Button>
          </>
        )}
        <Typography variant="body2" sx={{ textAlign: 'center' }}>
          <Link href="/login">Volver a iniciar sesión</Link>
        </Typography>
      </Stack>
    </AuthLayout>
  );
}
