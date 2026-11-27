'use client';

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
  isTerminalAppointmentStatus,
  type AppointmentDto,
  type CustomerDto,
  type ServiceDto,
} from '@turnosmart/shared';
import {
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  Clock3,
  Mail,
  Phone,
  StickyNote,
  UserRound,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { useNotifications } from '@/components/notifications/NotificationProvider';
import { use, useEffect, useRef, useState } from 'react';
import { AppointmentStatusBadge } from '@/components/appointments/AppointmentStatusBadge';
import { RescheduleAppointmentDialog } from '@/components/appointments/RescheduleAppointmentDialog';
import type { PendingRescheduleRequestDto } from '@turnosmart/shared';
import { useAuth } from '@/components/AuthProvider';
import { EventHistory } from '@/components/EventHistory';
import { RiskExplanationPanel } from '@/components/RiskExplanationPanel';
import { useToast } from '@/components/ToastProvider';
import { listAgendaServices } from '@/lib/agenda-data';
import { api, ApiError, errorMessage } from '@/lib/api';
import {
  appointmentActions,
  canApplyAppointmentAction,
  canRescheduleAppointment,
  transitionAppointment,
  type AppointmentAction,
} from '@/lib/appointment-actions';
import { appointmentWindowLabel } from '@/lib/calendar-events';

const statusMessages: Record<AppointmentAction, string> = {
  confirm: 'Turno confirmado correctamente',
  cancel: 'Turno cancelado correctamente',
  complete: 'Turno completado correctamente',
  'no-show': 'Turno marcado como ausente',
};

const compactContent = { px: { xs: 1.75, sm: 2 }, py: 1.5, '&:last-child': { pb: 1.5 } };
const detailRow = { gap: 0.75, alignItems: 'center', flexWrap: 'wrap' };

export default function AppointmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useAuth();
  if (!me?.onboarded) return null;
  return (
    <AppointmentDetails
      key={me.business.id + '/' + me.user.id + '/' + id}
      id={id}
      timezone={me.business.timezone}
      canWrite={can(me.profile.role, 'appointments:write')}
    />
  );
}

function AppointmentDetails({
  id,
  timezone,
  canWrite,
}: {
  id: string;
  timezone: string;
  canWrite: boolean;
}) {
  const { appointmentRevision, navigationRevision } = useNotifications();
  const targetRequest = useSearchParams().get('solicitud');
  const requestRegion = useRef<HTMLDivElement>(null);
  const focusedRequest = useRef<string | null>(null);
  const [appointment, setAppointment] = useState<AppointmentDto | null>(null);
  const [customer, setCustomer] = useState<CustomerDto | null | undefined>(undefined);
  const [service, setService] = useState<ServiceDto | null | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [loadedRevision, setLoadedRevision] = useState('');
  const { notify, dismiss } = useToast();
  const [reload, setReload] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [rescheduling, setRescheduling] = useState(false);
  const [requestState, setRequestState] = useState<{
    revision: string;
    data?: PendingRescheduleRequestDto | null;
    error?: string;
  }>();
  const [reviewRequest, setReviewRequest] = useState<PendingRescheduleRequestDto>();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<AppointmentAction | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const customerId = appointment?.customerId;
  const serviceId = appointment?.serviceId;
  const startsAt = appointment?.startsAt;
  const freshAppointment = loadedRevision === `${appointmentRevision}/${targetRequest ?? ''}`;
  const requestKey = `${historyRevision}/${appointmentRevision}/${targetRequest ?? ''}`;
  const request = requestState?.revision === requestKey ? requestState.data : undefined;
  const requestError = requestState?.revision === requestKey ? requestState.error : undefined;
  const activeAppointment = appointment && !isTerminalAppointmentStatus(appointment.status);

  useEffect(() => {
    if (!activeAppointment) return;
    let active = true;
    api<PendingRescheduleRequestDto | null>(`/api/appointments/${id}/reschedule-request`).then(
      (data) => {
        if (active) setRequestState({ revision: requestKey, data });
      },
      (err) => {
        if (active) setRequestState({ revision: requestKey, error: errorMessage(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [activeAppointment, requestKey, id]);

  useEffect(() => {
    let current = true;
    api<AppointmentDto>('/api/appointments/' + id).then(
      (result) => {
        if (!current) return;
        setAppointment(result);
        setLoadedRevision(`${appointmentRevision}/${targetRequest ?? ''}`);
        setNow(Date.now());
        setLoadError('');
      },
      (error) => {
        if (current) {
          if (error instanceof ApiError && error.status === 404) setAppointment(null);
          setLoadError(errorMessage(error));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [id, reload, appointmentRevision, targetRequest]);

  useEffect(() => {
    if (!customerId) return;
    let current = true;
    api<CustomerDto>('/api/customers/' + customerId).then(
      (result) => {
        if (current) setCustomer(result);
      },
      () => {
        if (current) setCustomer(null);
      },
    );
    return () => {
      current = false;
    };
  }, [customerId]);

  useEffect(() => {
    if (!serviceId) return;
    let current = true;
    listAgendaServices('all', () => current).then(
      (result) => {
        if (current) setService(result.find((item) => item.id === serviceId) ?? null);
      },
      () => {
        if (current) setService(null);
      },
    );
    return () => {
      current = false;
    };
  }, [serviceId]);

  useEffect(() => {
    if (!startsAt) return;
    const start = Date.parse(startsAt);
    const delay = start - Date.now();
    const tick = () => setNow(Date.now());
    const timer = delay > 0 && delay <= 2_147_483_647 ? window.setTimeout(tick, delay) : undefined;
    window.addEventListener('focus', tick);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', tick);
    };
  }, [startsAt]);

  useEffect(() => {
    if (
      !targetRequest ||
      !appointment ||
      loadedRevision !== `${appointmentRevision}/${targetRequest}`
    )
      return;
    if (activeAppointment && request === undefined && !requestError) return;
    if (focusedRequest.current === `${targetRequest}/${navigationRevision}`) return;
    focusedRequest.current = `${targetRequest}/${navigationRevision}`;
    requestRegion.current?.focus({ preventScroll: true });
    requestRegion.current?.scrollIntoView({ block: 'nearest' });
  }, [
    targetRequest,
    appointment,
    loadedRevision,
    appointmentRevision,
    navigationRevision,
    activeAppointment,
    request,
    requestError,
  ]);

  function refresh() {
    setReload((value) => value + 1);
    setHistoryRevision((value) => value + 1);
  }

  function apply(
    result: AppointmentDto,
    message: string,
    severity: 'success' | 'warning' = 'success',
  ) {
    setAppointment(result);
    setHistoryRevision((value) => value + 1);
    notify(message, severity);
    setConfirmAction(null);
    setRescheduling(false);
    setReviewRequest(undefined);
  }

  async function rejectRequest() {
    if (
      !canWrite ||
      !activeAppointment ||
      !request ||
      request.id !== rejecting ||
      !freshAppointment ||
      pending.current
    )
      return;
    pending.current = true;
    setBusy(true);
    try {
      await api(`/api/appointments/${id}/reschedule-request/dismiss`, {
        method: 'POST',
        body: { requestId: rejecting },
      });
      notify('Solicitud rechazada. El turno conserva su horario.');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      pending.current = false;
      setBusy(false);
      setRejecting(null);
      refresh();
    }
  }

  async function changeStatus(action: AppointmentAction) {
    if (!appointment || !canWrite || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await transitionAppointment(appointment, action);
      apply(
        result.appointment,
        result.kind === 'saved'
          ? statusMessages[action]
          : 'El turno cambió. Revisá sus datos antes de continuar.',
        result.kind === 'saved' ? 'success' : 'warning',
      );
    } catch (error) {
      notify('No se pudo actualizar el turno. ' + errorMessage(error), 'error');
      setConfirmAction(null);
      refresh();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const actions =
    appointment && canWrite && freshAppointment
      ? (Object.keys(appointmentActions) as AppointmentAction[]).filter((action) =>
          canApplyAppointmentAction(appointment, action, now),
        )
      : [];
  const canReschedule =
    !!appointment &&
    freshAppointment &&
    canWrite &&
    service?.active !== false &&
    canRescheduleAppointment(appointment, now);
  const customerLabel =
    customer?.fullName ?? (customer === undefined ? 'Cargando cliente…' : 'Cliente no disponible');
  const serviceLabel =
    service?.name ?? (service === undefined ? 'Cargando servicio…' : 'Servicio no disponible');
  const windowLabel = appointment ? appointmentWindowLabel(appointment, timezone) : '';

  return (
    <Stack spacing={1.5}>
      <Stack component="header" spacing={0.5}>
        <PageBreadcrumbs
          items={[{ label: 'Agenda', href: '/#agenda' }, { label: 'Detalle del turno' }]}
        />
        <Typography variant="h1" sx={{ fontSize: { xs: '1.35rem', sm: '1.55rem' } }}>
          Detalle del turno
        </Typography>
      </Stack>
      {!appointment && !loadError && <LinearProgress aria-label="Cargando turno" />}
      {!appointment && loadError && (
        <Alert severity="error" action={<Button onClick={refresh}>Reintentar</Button>}>
          {loadError}
        </Alert>
      )}
      {appointment && !freshAppointment && loadError && (
        <Alert severity="error" action={<Button onClick={refresh}>Reintentar</Button>}>
          {loadError}
        </Alert>
      )}
      {appointment && (
        <>
          <Card component="section" aria-labelledby="appointment-customer">
            <CardContent sx={compactContent}>
              <Stack spacing={1.25}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  sx={{ gap: 0.75, justifyContent: 'space-between' }}
                >
                  <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <Typography id="appointment-customer" variant="h2" sx={{ fontSize: '1.3rem' }}>
                      {customerLabel}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {serviceLabel}
                    </Typography>
                  </Box>
                  <Stack spacing={0.25} sx={{ alignItems: { sm: 'flex-end' } }}>
                    <Stack direction="row" useFlexGap sx={detailRow}>
                      <Typography component="h2" variant="caption" color="text.secondary">
                        Estado del turno
                      </Typography>
                      <AppointmentStatusBadge status={appointment.status} />
                    </Stack>
                    {activeAppointment && (
                      <Typography variant="caption" color="text.secondary">
                        {appointment.confirmationStatus === 'CONFIRMED' ||
                        appointment.status === 'CONFIRMED'
                          ? 'Asistencia confirmada'
                          : 'Pendiente de confirmación'}
                      </Typography>
                    )}
                    {isTerminalAppointmentStatus(appointment.status) && (
                      <Typography variant="caption" color="text.secondary">
                        El turno está cerrado.
                      </Typography>
                    )}
                  </Stack>
                </Stack>
                <Stack
                  direction="row"
                  useFlexGap
                  sx={{ gap: 1.25, flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
                    <CalendarDays size={17} aria-hidden style={{ flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {windowLabel}
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={<Clock3 size={14} aria-hidden />}
                    label={
                      (Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000 +
                      ' min'
                    }
                  />
                </Stack>
                <Box
                  id="solicitud-reprogramacion"
                  ref={requestRegion}
                  tabIndex={-1}
                  aria-label="Revisión de reprogramación"
                  sx={{
                    scrollMarginTop: '64px',
                    '&:focus-visible': {
                      outline: '2px solid',
                      outlineColor: 'primary.main',
                      borderRadius: 1,
                    },
                  }}
                >
                  {targetRequest &&
                    loadedRevision === `${appointmentRevision}/${targetRequest}` &&
                    !requestError &&
                    (!activeAppointment ||
                      request === null ||
                      (request && request.createdAt !== targetRequest)) && (
                      <Alert severity="info" sx={{ mb: request ? 1 : 0 }}>
                        {!activeAppointment
                          ? 'El turno está cerrado. Esta solicitud ya no se puede gestionar.'
                          : request
                            ? 'El aviso corresponde a una solicitud anterior. Se muestra la solicitud vigente.'
                            : 'Esta solicitud ya fue resuelta o no está vigente.'}
                      </Alert>
                    )}
                  {activeAppointment && requestError && (
                    <Alert severity="error" action={<Button onClick={refresh}>Reintentar</Button>}>
                      {requestError}
                    </Alert>
                  )}
                  {activeAppointment && !requestError && request === undefined && (
                    <Typography variant="caption" role="status">
                      Consultando solicitudes de reprogramación…
                    </Typography>
                  )}
                  {activeAppointment && request && (
                    <Alert severity="info" icon={<CalendarClock size={18} aria-hidden />}>
                      <Stack spacing={1}>
                        <Typography variant="subtitle2">Reprogramación solicitada</Typography>
                        {request.requestedStartsAt && (
                          <Typography variant="body2">
                            Horario propuesto:{' '}
                            {new Intl.DateTimeFormat('es-AR', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                              hourCycle: 'h23',
                              timeZone: timezone,
                            }).format(new Date(request.requestedStartsAt))}
                          </Typography>
                        )}
                        {request.message && (
                          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                            {request.message}
                          </Typography>
                        )}
                        {canWrite && (
                          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                            <Button
                              size="small"
                              variant="outlined"
                              disabled={!canReschedule || busy}
                              onClick={() => setReviewRequest(request)}
                            >
                              Revisar y aprobar
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              disabled={busy || !freshAppointment}
                              onClick={() => setRejecting(request.id)}
                            >
                              Rechazar solicitud
                            </Button>
                          </Stack>
                        )}
                      </Stack>
                    </Alert>
                  )}
                </Box>
                {((canReschedule && !request) || actions.length > 0) && (
                  <Stack
                    aria-label="Acciones del turno"
                    role="group"
                    direction="row"
                    useFlexGap
                    sx={{
                      gap: 0.75,
                      flexWrap: 'wrap',
                      pt: 1.25,
                      borderTop: 1,
                      borderColor: 'divider',
                    }}
                  >
                    {canReschedule && !request && (
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<CalendarClock size={17} aria-hidden />}
                        disabled={busy}
                        onClick={() => {
                          dismiss();
                          setRescheduling(true);
                        }}
                      >
                        Reprogramar
                      </Button>
                    )}
                    {actions.map((action) => (
                      <Button
                        key={action}
                        variant="outlined"
                        size="small"
                        color={action === 'cancel' || action === 'no-show' ? 'error' : 'primary'}
                        disabled={busy}
                        onClick={() => {
                          dismiss();
                          if (action === 'confirm') void changeStatus(action);
                          else setConfirmAction(action);
                        }}
                      >
                        {busy && action === 'confirm' && !confirmAction
                          ? 'Guardando…'
                          : appointmentActions[action].label}
                      </Button>
                    ))}
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent sx={compactContent}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1.5,
                  overflowWrap: 'anywhere',
                }}
              >
                <Stack component="section" aria-labelledby="appointment-contact" spacing={0.5}>
                  <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
                    <UserRound size={17} aria-hidden />
                    <Typography id="appointment-contact" variant="h2">
                      Cliente
                    </Typography>
                  </Stack>
                  {customer?.email && (
                    <Stack direction="row" useFlexGap sx={detailRow}>
                      <Mail size={15} aria-hidden />
                      <Typography variant="caption" color="text.secondary">
                        Correo
                      </Typography>
                      <Typography variant="body2">{customer.email}</Typography>
                    </Stack>
                  )}
                  {customer?.phone && (
                    <Stack direction="row" useFlexGap sx={detailRow}>
                      <Phone size={15} aria-hidden />
                      <Typography variant="caption" color="text.secondary">
                        Teléfono
                      </Typography>
                      <Typography variant="body2">{customer.phone}</Typography>
                    </Stack>
                  )}
                  {customer && !customer.email && !customer.phone && (
                    <Typography variant="body2" color="text.secondary">
                      Sin datos de contacto
                    </Typography>
                  )}
                </Stack>
                <Stack
                  component="section"
                  aria-labelledby="appointment-service"
                  spacing={0.5}
                  sx={{
                    borderStyle: 'solid',
                    borderWidth: { xs: '1px 0 0', sm: '0 0 0 1px' },
                    borderColor: 'divider',
                    pt: { xs: 1.5, sm: 0 },
                    pl: { sm: 1.5 },
                  }}
                >
                  <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
                    <BriefcaseBusiness size={17} aria-hidden />
                    <Typography id="appointment-service" variant="h2">
                      Servicio
                    </Typography>
                  </Stack>
                  {service?.description && (
                    <Typography variant="body2" color="text.secondary">
                      {service.description}
                    </Typography>
                  )}
                  {service?.active === false && (
                    <Typography variant="body2" color="text.secondary">
                      Servicio inactivo
                    </Typography>
                  )}
                  {service?.active && !service.description && (
                    <Typography variant="body2" color="text.secondary">
                      Sin descripción
                    </Typography>
                  )}
                </Stack>
                {appointment.notes && (
                  <Box
                    sx={{ gridColumn: '1 / -1', pt: 1.25, borderTop: 1, borderColor: 'divider' }}
                  >
                    <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', mb: 0.5 }}>
                      <StickyNote size={17} aria-hidden />
                      <Typography variant="h2">Observaciones</Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {appointment.notes}
                    </Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>

          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
              alignItems: 'start',
            }}
          >
            {/* La clave cambia al reprogramar, confirmar o cerrar el turno: el panel vuelve a
                pedir la explicación y el servidor genera una nueva sólo si el score cambió. */}
            <RiskExplanationPanel
              key={[
                appointment.startsAt,
                appointment.endsAt,
                appointment.status,
                appointment.confirmationStatus,
              ].join('/')}
              appointmentId={id}
              compact
              autoLoad
            />
            <EventHistory
              appointmentId={id}
              timezone={timezone}
              revision={historyRevision + appointmentRevision}
            />
          </Box>

          {(rescheduling || reviewRequest) && (
            <RescheduleAppointmentDialog
              key={appointment.startsAt}
              appointment={appointment}
              timezone={timezone}
              request={reviewRequest}
              onClose={() => {
                setRescheduling(false);
                setReviewRequest(undefined);
              }}
              onSaved={(saved) => apply(saved, 'Turno reprogramado correctamente')}
              onStale={(fresh) =>
                apply(fresh, 'El turno cambió. Revisá su estado y horario.', 'warning')
              }
              onRefresh={refresh}
            />
          )}
          <Dialog
            open={rejecting !== null}
            onClose={() => {
              if (!busy) setRejecting(null);
            }}
            aria-labelledby="reject-reschedule-title"
          >
            <DialogTitle id="reject-reschedule-title">¿Rechazar la solicitud?</DialogTitle>
            <DialogContent>
              El turno conservará su horario actual.
              {rejecting &&
                freshAppointment &&
                request !== undefined &&
                request?.id !== rejecting && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    La solicitud cambió. Cerrá este diálogo y revisá su estado actual.
                  </Alert>
                )}
            </DialogContent>
            <DialogActions>
              <Button autoFocus disabled={busy} onClick={() => setRejecting(null)}>
                Volver
              </Button>
              <Button
                color="error"
                variant="contained"
                disabled={
                  busy || !freshAppointment || request?.id !== rejecting || !activeAppointment
                }
                onClick={rejectRequest}
              >
                {busy ? 'Guardando…' : 'Rechazar solicitud'}
              </Button>
            </DialogActions>
          </Dialog>
          {confirmAction && (
            <Dialog
              open
              fullWidth
              maxWidth="xs"
              onClose={() => {
                if (!pending.current) setConfirmAction(null);
              }}
              aria-labelledby="confirm-appointment-action"
            >
              <DialogTitle id="confirm-appointment-action">
                {appointmentActions[confirmAction].label}
              </DialogTitle>
              <DialogContent dividers>
                <Typography sx={{ fontWeight: 600 }}>
                  {customerLabel} · {serviceLabel}
                </Typography>
                <Typography color="text.secondary">{windowLabel}</Typography>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setConfirmAction(null)} disabled={busy}>
                  Volver
                </Button>
                <Button
                  variant="contained"
                  color={confirmAction === 'complete' ? 'primary' : 'error'}
                  disabled={busy || !actions.includes(confirmAction)}
                  onClick={() => void changeStatus(confirmAction)}
                >
                  {busy
                    ? 'Guardando…'
                    : confirmAction === 'cancel'
                      ? 'Confirmar cancelación'
                      : 'Confirmar cambio'}
                </Button>
              </DialogActions>
            </Dialog>
          )}
        </>
      )}
    </Stack>
  );
}
