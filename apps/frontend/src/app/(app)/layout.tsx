'use client';

import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { Button, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/components/AuthProvider';
import { Brand, softDangerButtonSx } from '@/components/ui';
import styles from './layout.module.css';

/** Navegación protegida: sin sesión → login; sin negocio → onboarding; cuenta inaccesible → error. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, me, meError } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    else if (status === 'signedIn' && me && !me.onboarded) router.replace('/onboarding');
  }, [status, me, router]);

  if (status === 'signedIn' && !me && meError) return <AccountError message={meError} />;

  if (status !== 'signedIn' || !me?.onboarded) {
    return (
      <div className={styles.loading}>
        <CircularProgress aria-label="Cargando" />
      </div>
    );
  }

  return (
    <main className={styles.shell}>
      <AppSidebar />
      <section className={styles.content}>{children}</section>
    </main>
  );
}

/** Hay sesión pero la API no pudo resolver la cuenta: permite reintentar o salir, nunca queda cargando. */
function AccountError({ message }: { message: string }) {
  const { refreshMe, signOut } = useAuth();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    await refreshMe();
    setRetrying(false);
  }

  return (
    <div className={styles.loading}>
      <Stack sx={{ width: '100%', maxWidth: 440, gap: 3, p: 2.5 }}>
        <Brand />
        <Card role="alert">
          <CardContent>
            <Stack direction="row" sx={{ gap: 1, alignItems: 'center', mb: 1 }}>
              <CloudOffRoundedIcon color="error" fontSize="small" />
              <Typography variant="h2">No se pudo cargar tu cuenta</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Iniciaste sesión, pero el servidor no respondió con los datos de tu negocio.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1.5 }} data-testid="account-error">
              {message}
            </Typography>
            <Stack direction="row" sx={{ gap: 1, mt: 2.5, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                size="small"
                startIcon={
                  retrying ? <CircularProgress size={14} color="inherit" /> : <RefreshRoundedIcon />
                }
                onClick={retry}
                disabled={retrying}
              >
                Reintentar
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<LogoutRoundedIcon />}
                onClick={signOut}
                data-testid="logout"
                sx={softDangerButtonSx}
              >
                Cerrar sesión
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </div>
  );
}
