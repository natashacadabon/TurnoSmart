'use client';

import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';
import { softDangerButtonSx } from '@/components/ui';
import { accountHome } from '@/lib/account-home';

/** Cuenta autenticada sin perfil asignado o desactivada por el administrador de la plataforma. */
export default function NoAccessPage() {
  const { status, me, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    else if (me && me.access !== 'NONE') router.replace(accountHome(me));
  }, [status, me, router]);

  if (!me || me.access !== 'NONE')
    return (
      <AuthLayout>
        <Stack sx={{ alignItems: 'center', py: 2 }}>
          <CircularProgress aria-label="Cargando" />
        </Stack>
      </AuthLayout>
    );

  return (
    <AuthLayout>
      <Stack spacing={2.5} data-testid="no-access">
        <Typography variant="h1">
          {me.reason === 'DISABLED' ? 'Tu cuenta está desactivada' : 'Tu cuenta no tiene acceso'}
        </Typography>
        <Alert severity="warning">
          {me.reason === 'DISABLED'
            ? 'El administrador de la plataforma desactivó tu acceso. Comunicate con él para reactivarlo.'
            : 'Tu usuario no está asociado a ningún negocio. Registrá tu negocio o pedile una invitación al administrador de la plataforma.'}
        </Alert>
        <Typography variant="body2" color="text.secondary">
          Sesión iniciada como {me.user.email ?? 'usuario sin email'}.
        </Typography>
        <Button
          variant="outlined"
          startIcon={<LogoutRoundedIcon />}
          onClick={signOut}
          sx={softDangerButtonSx}
        >
          Cerrar sesión
        </Button>
      </Stack>
    </AuthLayout>
  );
}
