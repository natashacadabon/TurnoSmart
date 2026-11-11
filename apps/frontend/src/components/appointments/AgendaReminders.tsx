'use client';

import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import type { AppointmentDto, CustomerDto } from '@turnosmart/shared';
import { Bell, Clock3, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  agendaReminders,
  canApplyReminderAction,
  reminderActions,
  REMINDER_SNOOZE_MS,
  type ReminderAction,
  type ReminderPreference,
  type ReminderPreferences,
} from '@/lib/agenda-reminders';
import { api, errorMessage } from '@/lib/api';
import { transitionAppointment } from '@/lib/appointment-actions';
import { listAgendaServices } from '@/lib/agenda-data';
import { slotTimeFormatter } from '@/lib/calendar-events';
import { AppointmentStatusBadge } from './AppointmentStatusBadge';

interface Props {
  appointments: AppointmentDto[];
  now: number;
  timezone: string;
  scope: string;
  canWrite: boolean;
  paused: boolean;
  onChanged(appointment?: AppointmentDto): void;
}

function readPreferences(key: string): ReminderPreferences {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function AgendaReminders({
  appointments,
  now,
  timezone,
  scope,
  canWrite,
  paused,
  onChanged,
}: Props) {
  const storageKey = 'turnosmart:agenda-reminders:' + scope;
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const [tick, setTick] = useState(now);
  const [selection, setSelection] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [cancelKey, setCancelKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ severity: 'error' | 'success'; text: string } | null>(
    null,
  );
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [services, setServices] = useState<Record<string, string> | null>(null);
  const pending = useRef(false);
  const clock = Math.max(tick, now);
  const { queue, nextTick } = agendaReminders(appointments, clock, timezone, preferences);
  const current =
    queue.find((item) => item.key === selection) ?? queue.find((item) => item.fresh) ?? queue[0];
  const open = !paused && !!current && (manualOpen || queue.some((item) => item.fresh));
  const customerId = open ? current?.appointment.customerId : undefined;
  const customerName = customerId ? customers[customerId] : undefined;
  const needsServices = open && services === null;

  useEffect(() => {
    if (!Number.isFinite(nextTick)) return;
    const timer = window.setTimeout(() => setTick(Date.now()), Math.max(0, nextTick - Date.now()));
    return () => window.clearTimeout(timer);
  }, [clock, nextTick]);

  useEffect(() => {
    if (!customerId || customerName !== undefined) return;
    let active = true;
    function save(name: string) {
      if (active && customerId) setCustomers((previous) => ({ ...previous, [customerId]: name }));
    }
    api<CustomerDto>('/api/customers/' + customerId).then(
      (customer) => save(customer.fullName),
      () => save('Cliente no disponible'),
    );
    return () => {
      active = false;
    };
  }, [customerId, customerName]);

  useEffect(() => {
    if (!needsServices) return;
    let active = true;
    async function load() {
      const catalog = await listAgendaServices('all', () => active);
      if (active)
        setServices(Object.fromEntries(catalog.map((service) => [service.id, service.name])));
    }
    void load().catch(() => {
      if (active) setServices({});
    });
    return () => {
      active = false;
    };
  }, [needsServices]);

  function updatePreferences(next: ReminderPreferences) {
    setPreferences(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* La cola sigue funcionando en memoria. */
    }
  }

  function savePreference(key: string, preference: ReminderPreference) {
    updatePreferences({ ...preferences, [key]: preference });
    setSelection(null);
    setCancelKey(null);
  }

  function close() {
    if (pending.current) return;
    setManualOpen(false);
    setSelection(null);
    setCancelKey(null);
    setFeedback(null);
    const updated = { ...preferences };
    for (const item of queue) updated[item.key] = { ...preferences[item.key], seen: item.phase };
    updatePreferences(updated);
  }

  async function act(action: ReminderAction) {
    if (!current || !canWrite || pending.current) return;
    const { appointment, key } = current;
    if (action === 'cancel' && cancelKey !== key) {
      setCancelKey(key);
      return;
    }
    pending.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await transitionAppointment(appointment, action, canApplyReminderAction);
      if (result.kind === 'stale') {
        onChanged(result.appointment);
        setFeedback({
          severity: 'error',
          text: 'El turno cambió. Revisá su horario y estado antes de volver a intentar.',
        });
        return;
      }
      savePreference(key, { dismissed: true });
      onChanged(result.appointment);
      setFeedback({ severity: 'success', text: 'Estado del turno actualizado.' });
    } catch (err) {
      setFeedback({ severity: 'error', text: errorMessage(err) });
      onChanged();
    } finally {
      pending.current = false;
      setBusy(false);
      setCancelKey(null);
    }
  }

  const appointment = current?.appointment;
  const format = slotTimeFormatter(timezone);
  const index = current ? queue.indexOf(current) : 0;
  return (
    <>
      <IconButton
        aria-label={`Avisos de turnos (${queue.length})`}
        aria-expanded={open}
        disabled={paused || !queue.length}
        onClick={() => {
          if (open) close();
          else {
            setSelection(queue[0]?.key ?? null);
            setManualOpen(true);
          }
        }}
      >
        <Badge badgeContent={queue.length} color="primary">
          <Bell size={19} aria-hidden />
        </Badge>
      </IconButton>
      <Snackbar
        open={!paused && (open || !!feedback)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        autoHideDuration={open ? null : 6000}
        onClose={(_, reason) => {
          if (reason !== 'clickaway') close();
        }}
      >
        {open && current && appointment ? (
          <Card
            component="section"
            aria-label="Aviso de turno"
            sx={{ width: 'min(420px, calc(100vw - 24px))', maxHeight: '75dvh', overflowY: 'auto' }}
          >
            <CardContent>
              <Stack spacing={1.25}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                  <Clock3 size={19} aria-hidden />
                  <Typography variant="h2" sx={{ flex: 1 }} role="status">
                    {current.phase === 'soon'
                      ? 'Turno próximo'
                      : current.minutes === 0
                        ? 'Es hora del turno'
                        : 'Turno pendiente'}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label="Cerrar avisos"
                    onClick={close}
                    disabled={busy}
                  >
                    <X size={17} aria-hidden />
                  </IconButton>
                </Stack>
                <Typography sx={{ fontWeight: 700 }}>
                  {customerName ?? 'Cargando cliente…'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {services
                    ? (services[appointment.serviceId] ?? 'Servicio no disponible')
                    : 'Cargando servicio…'}
                </Typography>
                <Stack
                  direction="row"
                  useFlexGap
                  sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}
                >
                  <Typography variant="body2">
                    {format.format(new Date(appointment.startsAt))} –{' '}
                    {format.format(new Date(appointment.endsAt))}
                  </Typography>
                  <AppointmentStatusBadge status={appointment.status} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {current.phase === 'soon'
                    ? `Comienza en ${current.minutes} min`
                    : current.minutes === 0
                      ? 'El turno acaba de comenzar'
                      : 'El horario de inicio ya pasó'}
                </Typography>
                {feedback && <Alert severity={feedback.severity}>{feedback.text}</Alert>}
                {cancelKey === current.key ? (
                  <Stack spacing={1}>
                    <Typography variant="body2">¿Querés cancelar este turno?</Typography>
                    <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        color="error"
                        variant="contained"
                        disabled={busy}
                        onClick={() => void act('cancel')}
                      >
                        Confirmar cancelación
                      </Button>
                      <Button size="small" disabled={busy} onClick={() => setCancelKey(null)}>
                        Volver
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  canWrite && (
                    <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap' }}>
                      {(Object.keys(reminderActions) as ReminderAction[])
                        .filter((action) => canApplyReminderAction(appointment, action, clock))
                        .map((action) => (
                          <Button
                            key={action}
                            size="small"
                            variant={action === 'confirm' ? 'contained' : 'outlined'}
                            color={
                              action === 'cancel' || action === 'no-show' ? 'error' : 'primary'
                            }
                            disabled={busy}
                            onClick={() => void act(action)}
                          >
                            {reminderActions[action].label}
                          </Button>
                        ))}
                    </Stack>
                  )
                )}
                <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    component={Link}
                    href={'/appointments/' + appointment.id}
                    disabled={busy}
                    onClick={close}
                  >
                    Ver turno
                  </Button>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      savePreference(current.key, { until: Date.now() + REMINDER_SNOOZE_MS });
                      setFeedback(null);
                    }}
                  >
                    Recordar en 5 min
                  </Button>
                  <Button
                    size="small"
                    color="inherit"
                    disabled={busy}
                    onClick={() => {
                      savePreference(current.key, { dismissed: true });
                      setFeedback(null);
                    }}
                  >
                    Descartar
                  </Button>
                </Stack>
                {queue.length > 1 && (
                  <Stack
                    direction="row"
                    sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <Box component="span">
                      {index + 1} de {queue.length} avisos
                    </Box>
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => {
                        setSelection(queue[(index + 1) % queue.length]!.key);
                        setManualOpen(true);
                        setCancelKey(null);
                        setFeedback(null);
                      }}
                    >
                      Siguiente aviso
                    </Button>
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>
        ) : (
          <Alert severity={feedback?.severity ?? 'info'} onClose={() => setFeedback(null)}>
            {feedback?.text}
          </Alert>
        )}
      </Snackbar>
    </>
  );
}
