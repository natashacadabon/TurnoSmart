'use client';

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { rescheduleAppointmentSchema, type AppointmentDto } from '@turnosmart/shared';
import { useRef, useState, type FormEvent } from 'react';
import { ToastViewport, useToastState } from '@/components/ToastProvider';
import { api, ApiError, errorMessage } from '@/lib/api';
import { appointmentChanged, canRescheduleAppointment } from '@/lib/appointment-actions';
import { businessDate } from '@/lib/booking';
import { appointmentWindowLabel } from '@/lib/calendar-events';
import { AppointmentSlotPicker, useAppointmentSlots } from './AppointmentSlotPicker';

async function reschedule(appointment: AppointmentDto, startsAt: string) {
  const path = '/api/appointments/' + appointment.id;
  const fresh = await api<AppointmentDto>(path);
  if (appointmentChanged(appointment, fresh) || !canRescheduleAppointment(fresh, Date.now())) {
    return { kind: 'stale' as const, appointment: fresh };
  }
  return {
    kind: 'saved' as const,
    appointment: await api<AppointmentDto>(path + '/reschedule', {
      method: 'POST',
      body: rescheduleAppointmentSchema.parse({ startsAt }),
    }),
  };
}

export function RescheduleAppointmentDialog({
  appointment,
  timezone,
  onClose,
  onSaved,
  onStale,
  onRefresh,
}: {
  appointment: AppointmentDto;
  timezone: string;
  onClose(): void;
  onSaved(appointment: AppointmentDto): void;
  onStale(appointment: AppointmentDto): void;
  onRefresh(): void;
}) {
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));
  const slots = useAppointmentSlots({
    timezone,
    serviceId: appointment.serviceId,
    initialDate: businessDate(new Date(appointment.startsAt), timezone),
    excludeAppointmentId: appointment.id,
    omitStart: appointment.startsAt,
  });
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast, notify, dismiss } = useToastState();
  const pending = useRef(false);
  const selection = slots.selected;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selection || pending.current) return;
    if (!review) {
      dismiss();
      setReview(true);
      return;
    }
    pending.current = true;
    setSaving(true);
    try {
      const result = await reschedule(appointment, selection.startsAt);
      if (result.kind === 'stale') onStale(result.appointment);
      else onSaved(result.appointment);
    } catch (err) {
      notify('No se pudo reprogramar el turno. ' + errorMessage(err), 'error');
      setReview(false);
      if (err instanceof ApiError && err.status === 409) {
        slots.refresh();
        onRefresh();
      }
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  function close() {
    if (!pending.current) onClose();
  }

  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
      onClose={close}
      aria-labelledby="reschedule-title"
    >
      <Box
        component="form"
        noValidate
        onSubmit={submit}
        aria-busy={saving}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <DialogTitle id="reschedule-title">Reprogramar turno</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Box sx={{ bgcolor: 'background.default', borderRadius: 2, p: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Horario actual
              </Typography>
              <Typography>{appointmentWindowLabel(appointment, timezone)}</Typography>
              {review && selection && (
                <>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 1 }}
                  >
                    Nuevo horario
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>
                    {appointmentWindowLabel(selection, timezone)}
                  </Typography>
                </>
              )}
            </Box>
            {!review && <AppointmentSlotPicker slots={slots} disabled={saving} />}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          {review ? (
            <Button onClick={() => setReview(false)} disabled={saving}>
              Cambiar horario
            </Button>
          ) : (
            <Button onClick={close} disabled={saving}>
              Cerrar
            </Button>
          )}
          <Button type="submit" variant="contained" disabled={!selection || saving}>
            {saving ? 'Guardando…' : review ? 'Confirmar reprogramación' : 'Revisar cambio'}
          </Button>
        </DialogActions>
      </Box>
      <ToastViewport toast={toast} dismiss={dismiss} />
    </Dialog>
  );
}
