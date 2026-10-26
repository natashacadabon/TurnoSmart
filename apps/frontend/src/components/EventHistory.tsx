'use client';

import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import {
  APPOINTMENT_STATUSES,
  type AppointmentEventDto,
  type AppointmentEventType,
  type AppointmentStatus,
} from '@turnosmart/shared';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { EmptyState } from './ui';

const STATUS: Record<
  AppointmentStatus,
  { label: string; color: 'default' | 'info' | 'success' | 'error' | 'warning' }
> = {
  SCHEDULED: { label: 'Agendado', color: 'info' },
  CONFIRMED: { label: 'Confirmado', color: 'success' },
  CANCELLED: { label: 'Cancelado', color: 'error' },
  COMPLETED: { label: 'Completado', color: 'success' },
  NO_SHOW: { label: 'Ausente', color: 'warning' },
};

const TYPE_LABEL: Record<AppointmentEventType, string> = {
  CREATED: 'Turno creado',
  RESCHEDULED: 'Turno reprogramado',
  CONFIRMED: 'Turno confirmado',
  CANCELLED: 'Turno cancelado',
  COMPLETED: 'Turno completado',
  MARKED_NO_SHOW: 'Marcado como ausente',
};

/** C puede registrar el estado anterior/nuevo en metadata; se muestran sólo si son estados válidos. */
function statusFrom(metadata: AppointmentEventDto['metadata'], key: 'fromStatus' | 'toStatus') {
  const value = metadata?.[key];
  return APPOINTMENT_STATUSES.find((s) => s === value) ?? null;
}

const StatusChip = ({ status, outlined }: { status: AppointmentStatus; outlined?: boolean }) => (
  <Chip
    size="small"
    color={STATUS[status].color}
    variant={outlined ? 'outlined' : 'filled'}
    label={STATUS[status].label}
    sx={{ height: 22, fontSize: 12 }}
  />
);

/** Historial del turno en orden cronológico (C07). Sólo lectura. */
export function EventHistory({
  appointmentId,
  timezone,
}: {
  appointmentId: string;
  timezone: string;
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
  }, [appointmentId, reloadKey]);

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
    <Card>
      <CardContent>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Historial
        </Typography>
        {error && (
          <Alert severity="error" action={<Button onClick={reload}>Reintentar</Button>}>
            {error}
          </Alert>
        )}
        {!events && !error && (
          <Stack spacing={2}>
            <Skeleton width="80%" />
            <Skeleton width="60%" />
          </Stack>
        )}
        {events?.length === 0 && (
          <EmptyState
            icon={<HistoryRoundedIcon />}
            title="Sin movimientos"
            description="Los cambios del turno van a aparecer acá."
          />
        )}
        {events && events.length > 0 && (
          <Box
            component="ol"
            aria-label="Historial del turno"
            sx={{ m: 0, p: 0, listStyle: 'none' }}
          >
            {events.map((e, i) => {
              const last = i === events.length - 1;
              const fromStatus = statusFrom(e.metadata, 'fromStatus');
              const toStatus = statusFrom(e.metadata, 'toStatus');
              return (
                <Box component="li" key={e.id} sx={{ display: 'flex', gap: 1.75 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      pt: 0.75,
                    }}
                  >
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: last ? 'primary.main' : 'background.paper',
                        border: 2,
                        borderColor: 'primary.main',
                        flexShrink: 0,
                      }}
                    />
                    {!last && <Box sx={{ width: 2, flexGrow: 1, bgcolor: 'divider', my: 0.5 }} />}
                  </Box>
                  <Box sx={{ pb: last ? 0 : 2.5, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {TYPE_LABEL[e.type] ?? e.type}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {fmt.format(new Date(e.createdAt))}
                    </Typography>
                    {(fromStatus || toStatus) && (
                      <Stack
                        direction="row"
                        spacing={0.75}
                        sx={{ alignItems: 'center', mt: 0.75, flexWrap: 'wrap' }}
                      >
                        {fromStatus && <StatusChip status={fromStatus} outlined />}
                        {fromStatus && toStatus && (
                          <Typography variant="caption" color="text.secondary" aria-hidden>
                            →
                          </Typography>
                        )}
                        {toStatus && <StatusChip status={toStatus} />}
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
