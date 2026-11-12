'use client';

import {
  Alert,
  Button,
  Card,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { NotificationReadResponse, NotificationsResponse } from '@turnosmart/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  listNotifications,
  useNotifications,
} from '@/components/notifications/NotificationProvider';
import { NotificationRows } from '@/components/notifications/NotificationRows';
import { useToast } from '@/components/ToastProvider';
import { errorMessage } from '@/lib/api';

export default function NotificationsPage() {
  const { me } = useAuth();
  const { notify } = useToast();
  const { markAllRead } = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [anchors, setAnchors] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const changes = useRef(0);
  const [response, setResponse] = useState<{
    key: string;
    data?: NotificationsResponse;
    error?: string;
  } | null>(null);
  const cursor = anchors.at(-1);
  const key = `${filter}/${cursor ?? ''}`;
  const page = response?.key === key ? response : null;

  useEffect(() => {
    let active = true;
    const version = changes.current;
    void listNotifications(filter, 20, cursor).then(
      (data) => {
        if (active && changes.current === version) setResponse({ key, data });
      },
      (err) => {
        if (active && changes.current === version) setResponse({ key, error: errorMessage(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [filter, cursor, key, revision]);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setRevision((value) => value + 1);
    };
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  async function readAll() {
    setBusy(true);
    try {
      const readAt = await markAllRead();
      changes.current++;
      setResponse((previous) => {
        if (previous?.key !== key || !previous.data) return previous;
        return {
          ...previous,
          data: {
            ...previous.data,
            unreadCount: 0,
            items:
              filter === 'unread'
                ? []
                : previous.data.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
            nextCursor: filter === 'unread' ? null : previous.data.nextCursor,
          },
        };
      });
      setAnchors([]);
      setRevision((value) => value + 1);
      notify('Notificaciones marcadas como leídas');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function readOne(id: string, { readAt, unreadCount }: NotificationReadResponse) {
    changes.current++;
    setRevision((value) => value + 1);
    setResponse((previous) => {
      if (previous?.key !== key || !previous.data) return previous;
      const current = previous.data.items.find((item) => item.id === id);
      if (!current || current.readAt) return previous;
      return {
        ...previous,
        data: {
          ...previous.data,
          unreadCount,
          items:
            filter === 'unread'
              ? previous.data.items.filter((item) => item.id !== id)
              : previous.data.items.map((item) => (item.id === id ? { ...item, readAt } : item)),
        },
      };
    });
  }

  if (!me?.onboarded) return null;
  const next = page?.data?.nextCursor;
  return (
    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h1">Notificaciones</Typography>
        <Button component={Link} href="/#agenda" size="small">
          Volver a Agenda
        </Button>
      </Stack>
      <Card>
        <Stack
          direction="row"
          sx={{
            p: 1.25,
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <ToggleButtonGroup
            size="small"
            exclusive
            disabled={busy}
            aria-label="Filtrar notificaciones"
            value={filter}
            onChange={(_event, value: 'all' | 'unread' | null) => {
              if (!value) return;
              setFilter(value);
              setAnchors([]);
            }}
          >
            <ToggleButton value="all">Todas</ToggleButton>
            <ToggleButton value="unread">No leídas</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {page?.data && (
              <Typography variant="caption" color="text.secondary" aria-live="polite">
                {page.data.unreadCount} sin leer
              </Typography>
            )}
            <Button
              size="small"
              disabled={!page?.data?.unreadCount || busy}
              onClick={() => void readAll()}
            >
              Marcar todas como leídas
            </Button>
          </Stack>
        </Stack>
        {!page && (
          <Stack aria-label="Cargando notificaciones" sx={{ p: 1.5 }}>
            <Skeleton width="45%" />
            <Skeleton width="75%" />
          </Stack>
        )}
        {page?.error && (
          <Alert
            severity="error"
            action={
              <Button size="small" onClick={() => setRevision((value) => value + 1)}>
                Reintentar
              </Button>
            }
          >
            No se pudieron cargar las notificaciones.
          </Alert>
        )}
        {page?.data?.items.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {filter === 'unread'
              ? 'No hay notificaciones sin leer en esta página.'
              : 'No tenés notificaciones'}
          </Typography>
        )}
        {!!page?.data?.items.length && (
          <NotificationRows
            items={page.data.items}
            timezone={me.business.timezone}
            onRead={readOne}
          />
        )}
        {(anchors.length > 0 || next) && (
          <Stack direction="row" sx={{ px: 1, py: 0.5, justifyContent: 'space-between' }}>
            <Button
              size="small"
              disabled={!anchors.length}
              onClick={() => setAnchors((items) => items.slice(0, -1))}
            >
              Anterior
            </Button>
            <Button
              size="small"
              disabled={!next}
              onClick={() => {
                if (next) setAnchors((items) => [...items, next]);
              }}
            >
              Siguiente
            </Button>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
