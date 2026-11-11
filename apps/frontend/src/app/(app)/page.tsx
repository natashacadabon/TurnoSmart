'use client';

import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import QueryStatsRoundedIcon from '@mui/icons-material/QueryStatsRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
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
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { AgendaReminders } from '@/components/appointments/AgendaReminders';
import { RiskExplanationPanel } from '@/components/RiskExplanationPanel';
import { appointmentStates, businessDayRange } from '@/lib/agenda';
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
    />
  );
}

function AgendaDashboard({
  scope,
  name,
  timezone,
  canBook,
}: {
  scope: string;
  name: string;
  timezone: string;
  canBook: boolean;
}) {
  const [customers, setCustomers] = useState<number | null>(null);
  const [feed, setFeed] = useState<AppointmentDto[] | null>(null);
  const [week, setWeek] = useState<AvailabilityRulesResponse['data'] | null>(null);
  const [availabilityError, setAvailabilityError] = useState('');
  const [retry, setRetry] = useState(0);
  const [revision, setRevision] = useState(0);
  const [customerRevision, setCustomerRevision] = useState(0);
  const [calendarRevision, setCalendarRevision] = useState(0);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [riskAppointment, setRiskAppointment] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const currentTimezone = week?.timezone ?? timezone;
  const today = businessDate(new Date(now), currentTimezone);
  const { from } = businessDayRange(today, currentTimezone);
  // Prefetch la próxima fecha local antes de entrar en la ventana de 10 minutos.
  const horizon = businessDate(new Date(now + REMINDER_LEAD_MS + 60_000), currentTimezone);
  const { to } = businessDayRange(horizon, currentTimezone);
  const appointments = feed?.filter(
    (item) => businessDate(new Date(item.startsAt), currentTimezone) === today,
  );

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
        if (current) setFeed(result);
      },
      () => {
        /* Las acciones siempre revalidan los datos antes de escribir. */
      },
    );
    return () => {
      current = false;
    };
  }, [from, to, revision]);

  function reminderChanged(appointment?: AppointmentDto) {
    if (appointment)
      setFeed((items) => [
        ...(items ?? []).filter((item) => item.id !== appointment.id),
        appointment,
      ]);
    setRevision((value) => value + 1);
    setCalendarRevision((value) => value + 1);
  }

  const candidate = appointments?.find(
    (item) =>
      (item.status === 'SCHEDULED' || item.status === 'CONFIRMED') &&
      Date.parse(item.startsAt) > now,
  );
  const metrics = [
    {
      label: 'Turnos hoy',
      value: appointments?.length,
      icon: <CalendarMonthRoundedIcon fontSize="small" />,
    },
    { label: 'Clientes', value: customers, icon: <GroupsRoundedIcon fontSize="small" /> },
    {
      label: 'Riesgo alto',
      value: null,
      icon: <WarningAmberRoundedIcon fontSize="small" />,
      hint: 'El riesgo se consulta por turno',
    },
    {
      label: 'Emails enviados',
      value: null,
      icon: <MailOutlineRoundedIcon fontSize="small" />,
      hint: 'El total de envíos aún no está disponible',
    },
  ];

  return (
    <Stack data-agenda-dashboard spacing={1.75} sx={{ minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ gap: 1, justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Box>
          <Typography variant="overline" color="text.secondary">
            {name}
          </Typography>
          <Typography variant="h1">Agenda</Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <AgendaReminders
            appointments={feed ?? []}
            now={now}
            timezone={currentTimezone}
            scope={scope}
            canWrite={canBook}
            paused={bookingOpen || !!riskAppointment}
            onChanged={reminderChanged}
          />
          <Button
            component={Link}
            href="/demo"
            size="small"
            variant="outlined"
            startIcon={<VisibilityRoundedIcon />}
          >
            Ver demo
          </Button>
          <Button
            component={Link}
            href="/customers"
            size="small"
            variant="outlined"
            startIcon={<GroupsRoundedIcon />}
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
          gap: { xs: 1, sm: 1.5 },
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
        }}
      >
        {metrics.map(({ label, icon, value, hint }) => (
          <Card key={label}>
            <Stack direction="row" sx={{ p: 1.25, gap: 1, alignItems: 'center' }}>
              <Box
                sx={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                  color: 'primary.main',
                }}
              >
                {icon}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {label}
                </Typography>
                <Typography
                  variant="h4"
                  sx={{ fontSize: '1.2rem', lineHeight: 1.1 }}
                  title={hint}
                  aria-label={hint}
                >
                  {value ?? '—'}
                </Typography>
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
          gap: 1.75,
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            lg: expanded ? 'minmax(0, 1fr)' : 'minmax(0, 3fr) minmax(230px, 1fr)',
          },
        }}
      >
        <Card id="agenda" sx={{ minWidth: 0 }}>
          <CardContent sx={{ p: { xs: 1.25, sm: 2 }, '&:last-child': { pb: { xs: 1.25, sm: 2 } } }}>
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

        <Stack
          component="aside"
          aria-label="Seguimiento de agenda"
          spacing={1.75}
          sx={{ display: { xs: 'flex', lg: expanded ? 'none' : 'flex' } }}
        >
          <Card id="riesgo">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <AutoAwesomeRoundedIcon color="primary" fontSize="small" />
                  <Typography variant="h2">Recomendación IA</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {candidate
                    ? 'Consultá el riesgo de ausencia y las recomendaciones para el próximo turno de hoy.'
                    : 'Abrí el detalle de un turno para consultar su riesgo y pedir una recomendación.'}
                </Typography>
                {candidate && (
                  <Button
                    onClick={() => setRiskAppointment(candidate.id)}
                    size="small"
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    Consultar IA
                  </Button>
                )}
              </Stack>
            </CardContent>
          </Card>
          <Card id="reportes">
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <QueryStatsRoundedIcon color="primary" fontSize="small" />
                  <Typography variant="h2">Salud de la agenda</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Resultados de los turnos de hoy
                </Typography>
                {(['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const).map((status) => (
                  <Stack
                    key={status}
                    direction="row"
                    sx={{ justifyContent: 'space-between', gap: 1 }}
                  >
                    <Typography variant="body2">{appointmentStates[status].label}</Typography>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 700 }}
                      color={appointmentStates[status].color}
                    >
                      {appointments?.filter((item) => item.status === status).length ?? '—'}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Box>
      {riskAppointment && (
        <Dialog
          open
          fullWidth
          maxWidth="sm"
          onClose={() => setRiskAppointment(null)}
          aria-labelledby="agenda-risk-title"
        >
          <DialogTitle id="agenda-risk-title">Recomendación IA</DialogTitle>
          <DialogContent>
            <RiskExplanationPanel appointmentId={riskAppointment} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRiskAppointment(null)}>Cerrar</Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
