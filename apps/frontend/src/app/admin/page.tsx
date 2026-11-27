'use client';

import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';
import { softDangerButtonSx } from '@/components/ui';
import { accountHome } from '@/lib/account-home';

/**
 * Entrada del ADMIN global de la plataforma. Sólo resuelve el acceso por rol; el panel de negocios
 * y propietarios (alta, invitaciones, activación) se implementa en FINAL-11.
 */
export default function PlatformAdminPage() {
  const { status, me, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    else if (me && me.access !== 'ADMIN') router.replace(accountHome(me));
  }, [status, me, router]);

  if (!me || me.access !== 'ADMIN')
    return (
      <AuthLayout>
        <Stack sx={{ alignItems: 'center', py: 2 }}>
          <CircularProgress aria-label="Cargando" />
        </Stack>
      </AuthLayout>
    );

  return (
    <AuthLayout>
      <Stack spacing={2.5} data-testid="platform-admin-home">
        <div>
          <Typography variant="overline" color="primary">
            Administración de la plataforma
          </Typography>
          <Typography variant="h1">Hola, {me.profile.fullName ?? me.user.email}</Typography>
        </div>
        <Alert severity="info">
          Desde acá vas a gestionar negocios y propietarios. Los administradores de la plataforma no
          operan agendas, clientes ni turnos.
        </Alert>
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
