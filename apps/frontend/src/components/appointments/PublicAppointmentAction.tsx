'use client';

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
  TextField,
  Typography,
} from '@mui/material';
import type { PublicAppointmentPreview } from '@turnosmart/shared';
import { useEffect, useRef, useState } from 'react';
import { Brand } from '@/components/ui';
import { ToastViewport, useToastState } from '@/components/ToastProvider';
import { api, ApiError, errorMessage } from '@/lib/api';
import { businessDate } from '@/lib/booking';
import { AppointmentSlotPicker, useAppointmentSlots } from './AppointmentSlotPicker';

const path = '/api/public/appointment-actions';
const expired = 'El enlace venció o ya no está disponible.';
const copy = {
  CONFIRM: { title: 'Confirmar asistencia', success: 'Tu asistencia quedó confirmada.' },
  CANCEL: { title: 'Cancelar turno', success: 'Tu turno fue cancelado.' },
  REQUEST_RESCHEDULE: {
    title: 'Solicitar reprogramación',
    success:
      'Enviamos tu solicitud. Tu horario original sigue reservado hasta que el negocio apruebe el cambio.',
  },
};

export function PublicAppointmentAction() {
  const token = useRef<string | undefined>(undefined);
  const [loaded, setLoaded] = useState<{ preview: PublicAppointmentPreview; token: string }>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (token.current === undefined) {
      token.current = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
      if (window.location.hash)
        window.history.replaceState(window.history.state, '', window.location.pathname);
    }
    let active = true;
    const value = token.current;
    const request = value
      ? api<PublicAppointmentPreview>(path + '/preview', {
          auth: false,
          method: 'POST',
          body: { token: value },
        })
      : Promise.reject(new ApiError(404, 'NOT_FOUND', expired));
    request.then(
      (preview) => {
        if (active) setLoaded({ preview, token: value });
      },
      (err) => {
        if (active)
          setError(err instanceof ApiError && err.status === 404 ? expired : errorMessage(err));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <Box
      component="main"
      sx={{ minHeight: '100dvh', bgcolor: 'background.default', px: 2, py: { xs: 3, sm: 7 } }}
    >
      <Stack spacing={2} sx={{ maxWidth: 560, mx: 'auto' }}>
        <Brand />
        <Card>
          <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
            {loaded ? (
              <ActionForm preview={loaded.preview} token={loaded.token} />
            ) : (
              <>
                <Typography component="h1" variant="h1" sx={{ mb: 2 }}>
                  Gestionar turno
                </Typography>
                {error ? (
                  <Alert
                    severity="error"
                    action={
                      error !== expired && (
                        <Button
                          onClick={() => {
                            setError('');
                            setAttempt(attempt + 1);
                          }}
                        >
                          Reintentar
                        </Button>
                      )
                    }
                  >
                    {error}
                  </Alert>
                ) : (
                  <LinearProgress aria-label="Cargando datos del turno" />
                )}
              </>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}

function ActionForm({ preview, token }: { preview: PublicAppointmentPreview; token: string }) {
  const { action, timezone, startsAt } = preview;
  const { title, success } = copy[action];
  const slots = useAppointmentSlots({
    timezone,
    serviceId: '',
    initialDate: businessDate(new Date(startsAt), timezone),
    omitStart: startsAt,
    ...(action === 'REQUEST_RESCHEDULE' &&
      preview.allowed &&
      !preview.alreadySubmitted && { publicToken: token }),
  });
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [blocked, setBlocked] = useState(!preview.allowed);
  const pending = useRef(false);
  const { toast, notify, dismiss } = useToastState();
  const date = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'full',
    timeStyle: 'short',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(startsAt));
  async function submit() {
    if (
      pending.current ||
      blocked ||
      invalid ||
      done ||
      (action === 'REQUEST_RESCHEDULE' && !slots.selected)
    )
      return;
    pending.current = true;
    setBusy(true);
    try {
      await api(path, {
        auth: false,
        method: 'POST',
        body: {
          token,
          confirmed: true,
          ...(action === 'REQUEST_RESCHEDULE' && {
            requestedStartsAt: slots.selected?.startsAt,
            ...(message.trim() && { message: message.trim() }),
          }),
        },
      });
      setDone(true);
      notify(success);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setInvalid(true);
      else {
        notify(errorMessage(err), 'error');
        if (
          err instanceof ApiError &&
          (err.code === 'APPOINTMENT_CANCELLATION_NOT_ALLOWED' || err.code === 'FORBIDDEN')
        )
          setBlocked(true);
        if (err instanceof ApiError && err.status === 409 && action === 'REQUEST_RESCHEDULE')
          slots.refresh();
      }
    } finally {
      pending.current = false;
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <Stack spacing={2} aria-busy={busy}>
      <Typography component="h1" variant="h1">
        {title}
      </Typography>
      <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
        <Typography sx={{ fontWeight: 700 }}>{preview.businessName}</Typography>
        <Typography>{preview.serviceName}</Typography>
        <Typography color="text.secondary">{date}</Typography>
      </Box>
      {done ? (
        <Alert severity="success" role="status">
          {success}
        </Alert>
      ) : preview.alreadySubmitted ? (
        <Alert severity="info" role="status">
          Ya enviaste una solicitud de reprogramación para este turno.
        </Alert>
      ) : invalid ? (
        <Alert severity="error">{expired}</Alert>
      ) : blocked ? (
        <Alert severity="warning">
          Esta acción no está disponible según la configuración y el plazo del negocio.
        </Alert>
      ) : (
        <>
          {action === 'REQUEST_RESCHEDULE' && (
            <>
              <Typography color="text.secondary">
                Tu horario original seguirá reservado hasta que el negocio apruebe el cambio.
              </Typography>
              <AppointmentSlotPicker slots={slots} disabled={busy} />
              <TextField
                label="Mensaje opcional"
                multiline
                minRows={2}
                value={message}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 500 } }}
                onChange={(event) => setMessage(event.target.value)}
              />
            </>
          )}
          <Button
            variant="contained"
            color={action === 'CANCEL' ? 'error' : 'primary'}
            disabled={busy || (action === 'REQUEST_RESCHEDULE' && !slots.selected)}
            onClick={() => (action === 'CANCEL' ? setConfirm(true) : void submit())}
          >
            {busy ? 'Enviando…' : action === 'REQUEST_RESCHEDULE' ? 'Enviar solicitud' : title}
          </Button>
        </>
      )}
      <Dialog
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        aria-labelledby="cancel-title"
      >
        <DialogTitle id="cancel-title">¿Cancelar este turno?</DialogTitle>
        <DialogContent>Al cancelar, el horario reservado quedará disponible.</DialogContent>
        <DialogActions>
          <Button autoFocus disabled={busy} onClick={() => setConfirm(false)}>
            Conservar turno
          </Button>
          <Button color="error" variant="contained" disabled={busy} onClick={submit}>
            {busy ? 'Cancelando…' : 'Sí, cancelar turno'}
          </Button>
        </DialogActions>
      </Dialog>
      <ToastViewport toast={toast} dismiss={dismiss} />
    </Stack>
  );
}
