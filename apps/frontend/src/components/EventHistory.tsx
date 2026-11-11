'use client';

import { Alert, Box, Button, Card, CardContent, Skeleton, Stack, Typography } from '@mui/material';
import {
  APPOINTMENT_STATUSES,
  type AppointmentEventDto,
  type AppointmentEventType,
  type AppointmentStatus,
} from '@turnosmart/shared';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CalendarPlus,
  CircleCheck,
  CircleX,
  History,
  UserX,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { AppointmentStatusBadge } from './appointments/AppointmentStatusBadge';

const ICON = {
  CREATED: CalendarPlus,
  RESCHEDULED: CalendarClock,
  CONFIRMED: BadgeCheck,
  CANCELLED: CircleX,
  COMPLETED: CircleCheck,
  MARKED_NO_SHOW: UserX,
};

const TYPE_LABEL: Record<AppointmentEventType, string> = {
  CREATED: 'Turno creado',
  RESCHEDULED: 'Turno reprogramado',
  CONFIRMED: 'Turno confirmado',
  CANCELLED: 'Turno cancelado',
  COMPLETED: 'Turno completado',
  MARKED_NO_SHOW: 'Marcado como ausente',
};

function statusFrom(value: unknown): AppointmentStatus | undefined {
  return APPOINTMENT_STATUSES.find((status) => status === value);
}

function instantFrom(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
}

/** Historial del turno en orden cronológico (C07). Sólo lectura. */
export function EventHistory({
  appointmentId,
  timezone,
  revision = 0,
}: {
  appointmentId: string;
  timezone: string;
  revision?: number;
}) {
  const [events, setEvents] = useState<AppointmentEventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    api<AppointmentEventDto[]>(`/api/appointments/${appointmentId}/events`).then(
      (result) => {
        if (!active) return;
        setEvents(result);
        setError(null);
      },
      (err) => {
        if (active) setError(errorMessage(err));
      },
    );
    return () => {
      active = false;
    };
  }, [appointmentId, reloadKey, revision]);

  const reload = () => {
    setError(null);
    setReloadKey((k) => k + 1);
  };

  const fmt = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  });

  return (
    <Card component="section" aria-labelledby="appointment-history">
      <CardContent sx={{ px: 2, py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', mb: 1 }}>
          <History size={17} aria-hidden />
          <Typography id="appointment-history" variant="h2">
            Historial
          </Typography>
        </Stack>
        {error && (
          <Alert severity="error" action={<Button onClick={reload}>Reintentar</Button>}>
            {error}
          </Alert>
        )}
        {!events && !error && (
          <Stack spacing={1}>
            <Skeleton width="80%" />
            <Skeleton width="60%" />
          </Stack>
        )}
        {events?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Sin movimientos registrados.
          </Typography>
        )}
        {events && events.length > 0 && (
          <Box
            component="ol"
            aria-label="Historial del turno"
            sx={{ m: 0, p: 0, listStyle: 'none' }}
          >
            {events.map((e, i) => {
              const last = i === events.length - 1;
              const fromStatus =
                statusFrom(e.metadata?.previousStatus) ?? statusFrom(e.metadata?.fromStatus);
              const toStatus = statusFrom(e.metadata?.status) ?? statusFrom(e.metadata?.toStatus);
              const previousStart =
                e.type === 'RESCHEDULED' ? instantFrom(e.metadata?.previousStartsAt) : null;
              const newStart = e.type === 'RESCHEDULED' ? instantFrom(e.metadata?.startsAt) : null;
              const Icon = ICON[e.type];
              return (
                <Box component="li" key={e.id} sx={{ display: 'flex', gap: 1 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      pt: 0.25,
                    }}
                  >
                    <Box sx={{ color: 'primary.main', display: 'flex', flexShrink: 0 }}>
                      <Icon size={16} aria-hidden />
                    </Box>
                    {!last && <Box sx={{ width: 2, flexGrow: 1, bgcolor: 'divider', my: 0.5 }} />}
                  </Box>
                  <Box sx={{ pb: last ? 0 : 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {TYPE_LABEL[e.type] ?? e.type}
                    </Typography>
                    {previousStart && (
                      <Typography
                        sx={{ display: 'block' }}
                        variant="caption"
                        color="text.secondary"
                      >
                        Antes · {fmt.format(previousStart)}
                      </Typography>
                    )}
                    {newStart && (
                      <Typography
                        sx={{ display: 'block' }}
                        variant="caption"
                        color="text.secondary"
                      >
                        Nuevo inicio · {fmt.format(newStart)}
                      </Typography>
                    )}
                    <Typography
                      component="time"
                      dateTime={e.createdAt}
                      variant="caption"
                      color="text.secondary"
                    >
                      {fmt.format(new Date(e.createdAt))}
                    </Typography>
                    {(fromStatus || toStatus) && (
                      <Stack
                        direction="row"
                        spacing={0.75}
                        sx={{ alignItems: 'center', mt: 0.75, flexWrap: 'wrap' }}
                      >
                        {fromStatus && <AppointmentStatusBadge status={fromStatus} />}
                        {fromStatus && toStatus && <ArrowRight size={14} aria-hidden />}
                        {toStatus && <AppointmentStatusBadge status={toStatus} />}
                      </Stack>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
