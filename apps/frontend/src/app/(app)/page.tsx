'use client';

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  LinearProgress,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import {
  can,
  type AppointmentDto,
  type AvailabilityRulesResponse,
  type CustomerDto,
  type Paginated,
} from '@turnosmart/shared';
import { CalendarDays, Eye, Mail, TriangleAlert, UsersRound } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { AgendaInsights } from '@/components/appointments/AgendaInsights';
import { AgendaReminders } from '@/components/appointments/AgendaReminders';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { businessDayRange } from '@/lib/agenda';
import { listAgendaAppointments } from '@/lib/agenda-data';
import { REMINDER_LEAD_MS } from '@/lib/agenda-reminders';
import { api, errorMessage } from '@/lib/api';
import { businessDate } from '@/lib/booking';

const AgendaCalendar = dynamic(
  () => import('@/components/appointments/AgendaCalendar').then((module) => module.AgendaCalendar),
  { ssr: false, loading: () => <LinearProgress aria-label="Cargando calendario" /> },
);

export default function AgendaPage() {
  const { me } = useAuth();
  if (!me?.onboarded) return null;
  return (
    <AgendaDashboard
      key={me.business.id + '/' + me.user.id}
      scope={me.business.id + '/' + me.user.id}
      name={me.business.name}
      timezone={me.business.timezone}
      canBook={can(me.profile.role, 'appointments:write')}
      canExplain={can(me.profile.role, 'risk:explain')}
    />
  );
}

function AgendaDashboard({
  scope,
  name,
  timezone,
  canBook,
  canExplain,
}: {
  scope: string;
  name: string;
  timezone: string;
  canBook: boolean;
  canExplain: boolean;
}) {
  const [customers, setCustomers] = useState<number | null>();
  const [feedResult, setFeedResult] = useState<{
    from: string;
    to: string;
    items: AppointmentDto[] | null;
  } | null>(null);
  const [week, setWeek] = useState<AvailabilityRulesResponse['data'] | null>(null);
  const [availabilityError, setAvailabilityError] = useState('');
  const [retry, setRetry] = useState(0);
  const [revision, setRevision] = useState(0);
  const [customerRevision, setCustomerRevision] = useState(0);
  const [calendarRevision, setCalendarRevision] = useState(0);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [riskDialogOpen, setRiskDialogOpen] = useState(false);
  const [riskCount, setRiskCount] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const currentTimezone = week?.timezone ?? timezone;
  const today = businessDate(new Date(now), currentTimezone);
  const { from, to: dayEnd } = businessDayRange(today, currentTimezone);
  // Prefetch la próxima fecha local antes de entrar en la ventana de 10 minutos.
  const horizon = businessDate(new Date(now + REMINDER_LEAD_MS + 60_000), currentTimezone);
  const { to } = businessDayRange(horizon, currentTimezone);
  const feed =
    feedResult && feedResult.from <= from && feedResult.to >= dayEnd ? feedResult.items : undefined;
  const appointments =
    feed?.filter((item) => businessDate(new Date(item.startsAt), currentTimezone) === today) ??
    feed;

  useEffect(() => {
    let current = true;
    let latest = 0;
    async function load() {
      const version = ++latest;
      try {
        const { data } = await api<AvailabilityRulesResponse>('/api/availability-rules');
        if (current && latest === version) {
          setWeek(data);
          setNow(Date.now());
          setAvailabilityError('');
        }
      } catch (err) {
        if (current && latest === version) setAvailabilityError(errorMessage(err));
      }
    }
    function refreshVisible() {
      if (!document.hidden) {
        setNow(Date.now());
        setRevision((value) => value + 1);
        void load();
      }
    }
    void load();
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    const timer = window.setInterval(refreshVisible, 60_000);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [retry]);

  useEffect(() => {
    let current = true;
    api<Paginated<CustomerDto>>('/api/customers?pageSize=1').then(
      (result) => {
        if (current) setCustomers(result.total);
      },
      () => {
        if (current) setCustomers(null);
      },
    );
    return () => {
      current = false;
    };
  }, [customerRevision]);

  useEffect(() => {
    let current = true;
    listAgendaAppointments({ from, to }, () => current).then(
      (result) => {
        if (current) setFeedResult({ from, to, items: result });
      },
      () => {
        if (current) setFeedResult({ from, to, items: null });
      },
    );
    return () => {
      current = false;
    };
  }, [from, to, revision]);

  function reminderChanged(appointment?: AppointmentDto) {
    if (appointment)
      setFeedResult((previous) =>
        previous?.items
          ? {
              ...previous,
              items: [...previous.items.filter((item) => item.id !== appointment.id), appointment],
            }
          : previous,
      );
    setRevision((value) => value + 1);
    setCalendarRevision((value) => value + 1);
  }

  const metrics = [
    {
      label: 'Turnos hoy',
      value: appointments ? appointments.length : appointments,
      icon: CalendarDays,
    },
    { label: 'Clientes', value: customers, icon: UsersRound },
    {
      label: 'Riesgo alto',
      value: appointments ? riskCount : appointments,
      icon: TriangleAlert,
      hint: 'Requiere un análisis de cada turno activo de hoy',
      alert: true,
    },
    {
      label: 'Emails enviados',
      value: null,
      icon: Mail,
      hint: 'El total de envíos aún no está disponible',
    },
  ];

  return (
    <Stack data-agenda-dashboard spacing={1.5} sx={{ minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ gap: 1, justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Box>
          <Typography variant="body2" color="text.secondary">
            {name}
          </Typography>
          <Typography variant="h1" sx={{ fontSize: { xs: '1.5rem', sm: '1.65rem' } }}>
            Agenda
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <NotificationBell
            timezone={currentTimezone}
            refreshRevision={revision}
            onOpenChange={setNotificationsOpen}
          />
          <AgendaReminders
            appointments={feed ?? []}
            now={now}
            timezone={currentTimezone}
            scope={scope}
            canWrite={canBook}
            paused={bookingOpen || riskDialogOpen || notificationsOpen}
            onChanged={reminderChanged}
          />
          <Button
            component={Link}
            href="/demo"
            size="small"
            startIcon={<Eye size={17} aria-hidden />}
          >
            Ver demo
          </Button>
          <Button
            component={Link}
            href="/customers"
            size="small"
            startIcon={<UsersRound size={17} aria-hidden />}
          >
            Clientes
          </Button>
        </Stack>
      </Stack>

      <Box
        component="section"
        aria-label="Indicadores del día"
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
        }}
      >
        {metrics.map(({ label, icon: Icon, value, hint, alert }) => (
          <Card key={label} component="section" aria-label={label}>
            <Stack direction="row" sx={{ px: 1.25, py: 1, gap: 0.75, alignItems: 'center' }}>
              <Box
                sx={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 30,
                  height: 30,
                  flexShrink: 0,
                  borderRadius: 1,
                  bgcolor: alert ? 'warning.light' : 'action.hover',
                  color: alert ? 'warning.main' : 'primary.main',
                }}
              >
                <Icon size={17} aria-hidden />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {label}
                </Typography>
                {value === undefined ? (
                  <Skeleton width={36} height={21} aria-label={`Cargando ${label.toLowerCase()}`} />
                ) : value === null ? (
                  <Typography variant="body2" color="text.secondary" title={hint}>
                    Sin datos
                  </Typography>
                ) : (
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '1.2rem',
                      fontWeight: 700,
                      lineHeight: 1.1,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {value}
                  </Typography>
                )}
              </Box>
            </Stack>
          </Card>
        ))}
      </Box>

      <Box
        component="section"
        sx={{
          display: 'grid',
          alignItems: 'start',
          minWidth: 0,
          gap: 1.5,
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            lg: expanded ? 'minmax(0, 1fr)' : 'minmax(0, 3fr) minmax(248px, 1.1fr)',
          },
        }}
      >
        <Card id="agenda" sx={{ minWidth: 0 }}>
          <CardContent sx={{ p: { xs: 1, sm: 1.5 }, '&:last-child': { pb: { xs: 1, sm: 1.5 } } }}>
            {availabilityError && (
              <Alert
                severity="error"
                sx={{ mb: 1 }}
                action={<Button onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}
              >
                {availabilityError}
              </Alert>
            )}
            {week ? (
              <AgendaCalendar
                timezone={week.timezone}
                rules={week.rules}
                canBook={canBook}
                expanded={expanded}
                appointmentRevision={calendarRevision}
                customerRevision={customerRevision}
                onBookingOpenChange={setBookingOpen}
                onToggleExpanded={() => setExpanded((value) => !value)}
                onAppointmentSaved={() => {
                  setRevision((value) => value + 1);
                  setCustomerRevision((value) => value + 1);
                }}
              />
            ) : (
              !availabilityError && <LinearProgress aria-label="Cargando horarios de atención" />
            )}
          </CardContent>
        </Card>

        <AgendaInsights
          appointments={appointments ?? null}
          now={now}
          timezone={currentTimezone}
          expanded={expanded}
          canExplain={canExplain}
          onRiskDialogChange={setRiskDialogOpen}
          onHighRiskCountChange={setRiskCount}
        />
      </Box>
    </Stack>
  );
}
