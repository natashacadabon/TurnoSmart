'use client';

import { Alert, Box, Button, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import { slotsQuerySchema, type SlotDto, type SlotsResponse } from '@turnosmart/shared';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { businessDate } from '@/lib/booking';
import { slotTimeFormatter } from '@/lib/calendar-events';

export function useAppointmentSlots({
  timezone,
  serviceId,
  initialDate,
  initialStartsAt,
  excludeAppointmentId,
  omitStart,
}: {
  timezone: string;
  serviceId: string;
  initialDate?: string;
  initialStartsAt?: string;
  excludeAppointmentId?: string;
  omitStart?: string;
}) {
  const today = businessDate(new Date(), timezone);
  const [date, setDate] = useState(initialDate ?? today);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: SlotDto[]; error: string } | null>(
    null,
  );
  const [startsAt, setStartsAt] = useState('');
  const suggestedStart = useRef(initialStartsAt);
  const validDate = slotsQuerySchema.shape.date.safeParse(date).success && date >= today;
  const query = { serviceId, date, ...(excludeAppointmentId ? { excludeAppointmentId } : {}) };
  const validQuery = validDate && slotsQuerySchema.safeParse(query).success;
  const params = new URLSearchParams(query).toString();
  const key = params + '/' + retry;
  const current = result?.key === key ? result : null;
  const selected = current?.data.find((slot) => slot.startsAt === startsAt);

  useEffect(() => {
    if (!validQuery) return;
    let active = true;
    api<SlotsResponse>('/api/slots?' + params).then(
      ({ data }) => {
        if (!active) return;
        const available = data.filter((slot) => slot.startsAt !== omitStart);
        setResult({ key, data: available, error: '' });
        if (initialDate === date && suggestedStart.current) {
          setStartsAt(
            available.find((slot) => slot.startsAt === suggestedStart.current)?.startsAt ?? '',
          );
        }
        suggestedStart.current = undefined;
      },
      (error) => {
        if (active) setResult({ key, data: [], error: errorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [date, initialDate, key, omitStart, params, validQuery]);

  function refresh() {
    suggestedStart.current = undefined;
    setStartsAt('');
    setRetry((value) => value + 1);
  }

  return {
    date,
    today,
    validDate,
    validQuery,
    current,
    selected,
    serviceId,
    timezone,
    refresh,
    loading: validQuery && !current,
    select: setStartsAt,
    changeDate(value: string) {
      setDate(value);
      refresh();
    },
    // Conservar la sugerencia inicial mientras todavía se elige el servicio.
    clearServiceSelection() {
      setStartsAt('');
      setResult(null);
    },
  };
}

export function AppointmentSlotPicker({
  slots,
  disabled,
  error,
  onEdit,
}: {
  slots: ReturnType<typeof useAppointmentSlots>;
  disabled: boolean;
  error?: string;
  onEdit?(): void;
}) {
  const format = slotTimeFormatter(slots.timezone);
  return (
    <Stack spacing={2}>
      <Typography component="h2" variant="h2">
        Fecha y horario
      </Typography>
      <TextField
        label="Fecha"
        type="date"
        required
        value={slots.date}
        disabled={disabled}
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: slots.today } }}
        error={!slots.validDate}
        helperText={!slots.validDate ? 'Elegí una fecha desde hoy.' : undefined}
        onChange={(event) => {
          slots.changeDate(event.target.value);
          onEdit?.();
        }}
      />
      <Box role="group" aria-label="Horarios disponibles">
        {slots.loading && <LinearProgress aria-label="Consultando horarios disponibles" />}
        {!slots.serviceId && (
          <Typography color="text.secondary" variant="body2">
            Seleccioná un servicio para consultar los horarios.
          </Typography>
        )}
        {slots.current?.error && (
          <Alert
            severity="error"
            action={
              <Button onClick={slots.refresh} disabled={disabled}>
                Reintentar
              </Button>
            }
          >
            {slots.current.error}
          </Alert>
        )}
        {slots.current && !slots.current.error && !slots.current.data.length && (
          <Alert severity="info">No hay horarios disponibles. Probá otra fecha.</Alert>
        )}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))',
            gap: 1,
            maxHeight: 240,
            overflowY: 'auto',
            p: 0.5,
          }}
        >
          {slots.current?.data.map((slot) => (
            <Button
              key={slot.startsAt}
              variant={slots.selected?.startsAt === slot.startsAt ? 'contained' : 'outlined'}
              aria-pressed={slots.selected?.startsAt === slot.startsAt}
              disabled={disabled}
              sx={{ minHeight: 48, fontVariantNumeric: 'tabular-nums' }}
              onClick={() => {
                slots.select(slot.startsAt);
                onEdit?.();
              }}
            >
              {format.format(new Date(slot.startsAt))} – {format.format(new Date(slot.endsAt))}
            </Button>
          ))}
        </Box>
        {error && (
          <Typography color="error" variant="body2" role="alert">
            Seleccioná un horario disponible.
          </Typography>
        )}
        {slots.validQuery && (
          <Button size="small" onClick={slots.refresh} disabled={disabled || slots.loading}>
            Actualizar horarios
          </Button>
        )}
      </Box>
    </Stack>
  );
}
