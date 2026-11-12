'use client';

import {
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
import { Clock3, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
import { useNotifications } from '@/components/notifications/NotificationProvider';
import { useToast } from '@/components/ToastProvider';

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
  const router = useRouter();
  const { syncUpcoming, markRead } = useNotifications();
  const { notify } = useToast();
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const [tick, setTick] = useState(now);
  const [selection, setSelection] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [cancelKey, setCancelKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState<Record<string, string>>({});
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [services, setServices] = useState<Record<string, string> | null>(null);
  const pending = useRef(false);
  const clock = Math.max(tick, now);
  const local = agendaReminders(appointments, clock, timezone, preferences);
  const due = agendaReminders(appointments, clock, timezone, {});
  const queue = local.queue.filter((item) => registered[item.key]);
  const missing = due.queue
    .filter((item) => !registered[item.key])
    .map((item) => item.key)
    .sort()
    .join(',');
  const retryMinute = missing ? Math.floor(now / 60_000) : 0;
  const nextTick = Math.min(local.nextTick, due.nextTick);
  const current =
    queue.find((item) => item.key === selection) ?? queue.find((item) => item.fresh) ?? queue[0];
  const open = !paused && !!current && (manualOpen || queue.some((item) => item.fresh));
  const customerId = open ? current?.appointment.customerId : undefined;
  const customerName = customerId ? customers[customerId] : undefined;
  const needsServices = open && services === null;

  useEffect(() => {
    if (!missing) return;
    let active = true;
    void syncUpcoming().then(
      (items) => {
        if (active && items.length) {
          setRegistered((previous) => ({
            ...previous,
            ...Object.fromEntries(
              items.map((item) => [item.appointmentId + '/' + item.startsAt, item.id]),
            ),
          }));
        }
      },
      () => {
        /* Reintenta con la próxima actualización de Agenda. */
      },
    );
    return () => {
      active = false;
    };
  }, [missing, retryMinute, syncUpcoming]);

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
    try {
      const result = await transitionAppointment(appointment, action, canApplyReminderAction);
      if (result.kind === 'stale') {
        onChanged(result.appointment);
        notify(
          'El turno cambió. Revisá su horario y estado antes de volver a intentar.',
          'warning',
        );
        return;
      }
      savePreference(key, { dismissed: true });
      onChanged(result.appointment);
      notify('Estado del turno actualizado.');
    } catch (err) {
      notify(errorMessage(err), 'error');
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

  async function openAppointment() {
    if (!current || pending.current) return;
    const id = registered[current.key];
    if (!id) return;
    pending.current = true;
    setBusy(true);
    try {
      await markRead(id);
      pending.current = false;
      close();
      router.push('/appointments/' + current.appointment.id);
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Snackbar
      open={open}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      onClose={(_, reason) => {
        if (reason !== 'clickaway') close();
      }}
    >
      {current && appointment ? (
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
                <IconButton size="small" aria-label="Cerrar avisos" onClick={close} disabled={busy}>
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
                          color={action === 'cancel' || action === 'no-show' ? 'error' : 'primary'}
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
                <Button size="small" disabled={busy} onClick={() => void openAppointment()}>
                  Ver turno
                </Button>
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => {
                    savePreference(current.key, { until: Date.now() + REMINDER_SNOOZE_MS });
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
                    }}
                  >
                    Siguiente aviso
                  </Button>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      ) : undefined}
    </Snackbar>
  );
}
