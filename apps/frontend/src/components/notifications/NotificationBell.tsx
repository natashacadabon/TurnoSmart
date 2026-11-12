'use client';

import {
  Alert,
  Badge,
  Box,
  Button,
  IconButton,
  Popover,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { errorMessage } from '@/lib/api';
import { useNotifications } from './NotificationProvider';
import { NotificationRows } from './NotificationRows';

export function NotificationBell({
  timezone,
  refreshRevision,
  onOpenChange,
}: {
  timezone: string;
  refreshRevision: number;
  onOpenChange(open: boolean): void;
}) {
  const { recent, error, refresh, markAllRead } = useNotifications();
  const { notify } = useToast();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const unread = recent?.unreadCount ?? 0;

  useEffect(() => {
    void refresh();
  }, [refresh, refreshRevision]);

  async function readAll() {
    setBusy(true);
    try {
      await markAllRead();
      notify('Notificaciones marcadas como leídas');
      void refresh();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setAnchor(null);
    onOpenChange(false);
  };
  return (
    <>
      <IconButton
        aria-label={unread ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        aria-controls={anchor ? 'notifications-popover' : undefined}
        onClick={(event) => {
          setAnchor(event.currentTarget);
          onOpenChange(true);
          void refresh();
        }}
      >
        <Badge color="primary" badgeContent={unread} max={99}>
          <Bell size={19} aria-hidden />
        </Badge>
      </IconButton>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        marginThreshold={12}
        slotProps={{
          paper: {
            id: 'notifications-popover',
            role: 'dialog',
            'aria-labelledby': 'notifications-heading',
            sx: {
              width: 'min(400px, calc(100vw - 24px))',
              maxHeight: 'min(560px, calc(100dvh - 24px))',
              display: 'flex',
              flexDirection: 'column',
            },
          },
        }}
      >
        <Stack sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Typography id="notifications-heading" variant="h2">
            Notificaciones
          </Typography>
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 0.5,
              flexWrap: 'wrap',
            }}
          >
            <Typography variant="caption" color="text.secondary" aria-live="polite">
              {recent ? `${unread} sin leer` : 'Sin conteo disponible'}
            </Typography>
            <Button size="small" disabled={!unread || busy} onClick={() => void readAll()}>
              Marcar todas como leídas
            </Button>
          </Stack>
        </Stack>
        <Box sx={{ minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {error && (
            <Alert
              severity="error"
              action={
                <Button size="small" onClick={() => void refresh()}>
                  Reintentar
                </Button>
              }
            >
              No se pudieron cargar las notificaciones.
            </Alert>
          )}
          {!recent && !error && (
            <Stack aria-label="Cargando notificaciones" sx={{ p: 1.5 }}>
              <Skeleton width="55%" />
              <Skeleton width="88%" />
              <Skeleton width="40%" />
            </Stack>
          )}
          {!error && recent?.items.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              No tenés notificaciones
            </Typography>
          )}
          {!!recent?.items.length && (
            <NotificationRows items={recent.items} timezone={timezone} onNavigate={close} />
          )}
        </Box>
        <Box sx={{ p: 1, borderTop: 1, borderColor: 'divider', textAlign: 'center' }}>
          <Button component={Link} href="/notifications" size="small" onClick={close}>
            Ver todas las notificaciones
          </Button>
        </Box>
      </Popover>
    </>
  );
}
