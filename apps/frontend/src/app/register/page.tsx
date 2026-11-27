'use client';

import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { AuthErrorAlert } from '@/components/AuthErrorAlert';
import { AuthLink } from '@/components/AuthLink';
import { useAuth } from '@/components/AuthProvider';
import { accountHome } from '@/lib/account-home';
import { PASSWORD_MIN_LENGTH, newPasswordProblem } from '@/lib/auth-flow.mjs';

/**
 * Registro público (FINAL-10). Crea la cuenta en Supabase Auth y envía el correo de verificación;
 * al abrir el enlace, la cuenta sin perfil completa el alta del negocio en /onboarding.
 */
export default function RegisterPage() {
  const { status, me, signUp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<'password' | 'confirmation' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'signedIn' && me) router.replace(accountHome(me));
  }, [status, me, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = newPasswordProblem(password, confirmation);
    setErrorField(problem?.field ?? null);
    if (problem) {
      setError(problem.message);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signUp(email.trim(), password);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <Stack component="form" spacing={2.5} onSubmit={onSubmit}>
        <div>
          <Typography variant="h1">Registrá tu negocio</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Creá tu cuenta de dueño/a. Después de verificar el correo vas a configurar tu negocio.
          </Typography>
        </div>
        {sent ? (
          <Alert severity="success" data-testid="register-sent">
            Te enviamos un enlace de verificación a {email.trim()}. Abrilo para continuar; vence en
            una hora. Si ya tenías cuenta, iniciá sesión o recuperá tu contraseña.
          </Alert>
        ) : (
          <>
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
              type="password"
              autoComplete="new-password"
              required
              error={errorField === 'password'}
              helperText={`Al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrorField(null);
              }}
            />
            <TextField
              label="Repetí la contraseña"
              type="password"
              autoComplete="new-password"
              required
              error={errorField === 'confirmation'}
              helperText={
                errorField === 'confirmation' ? 'Tiene que ser igual a la contraseña.' : undefined
              }
              value={confirmation}
              onChange={(e) => {
                setConfirmation(e.target.value);
                setErrorField(null);
              }}
            />
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? 'Creando cuenta…' : 'Crear cuenta'}
            </Button>
          </>
        )}
        <Typography variant="body2" sx={{ textAlign: 'center' }}>
          ¿Ya tenés cuenta? <AuthLink href="/login">Iniciá sesión</AuthLink>
        </Typography>
      </Stack>
    </AuthLayout>
  );
}
