'use client';

import { Alert, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';

/** Punto de entrada del ADMIN global; la gestión de negocios y OWNERS se agrega en FINAL-11. */
export default function PlatformAdminPage() {
  const { me, status, signOut } = useAuth();
  const router = useRouter();

  if (status !== 'signedIn' || !me?.platformAdmin) {
    return null;
  }

  return (
    <AuthLayout>
      <Stack spacing={2}>
        <Typography variant="overline" color="primary">
          Administración global
        </Typography>
        <Typography variant="h1">Panel de plataforma</Typography>
        <Alert severity="info">
          Tu cuenta ADMIN no pertenece a un negocio y no tiene acceso a turnos, clientes, servicios
          ni disponibilidad. La gestión de negocios y propietarios se implementará en FINAL-11.
        </Alert>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              Cuenta: {me.user.email ?? me.user.id}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Rol: ADMIN global
            </Typography>
          </CardContent>
        </Card>
        <Button variant="outlined" onClick={() => void signOut()}>
          Cerrar sesión
        </Button>
        <Button color="inherit" onClick={() => router.replace('/login')}>
          Volver al acceso
        </Button>
      </Stack>
    </AuthLayout>
  );
}
