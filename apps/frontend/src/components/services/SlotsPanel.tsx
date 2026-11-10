'use client';

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  slotsQuerySchema,
  type ServiceDto,
  type SlotDto,
  type SlotsResponse,
} from '@turnosmart/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { slotTimeFormatter, slotToCalendarEvent } from '@/lib/calendar-events';
import { timezoneCity } from '@/lib/timezones';

export function SlotsPanel({ services, timezone }: { services: ServiceDto[]; timezone: string }) {
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<SlotDto[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState('');
  const headingId = useId();
  const noticeId = useId();
  const pending = useRef(false);
  const active = services.filter((service) => service.active);
  const selected = active.some((service) => service.id === serviceId) ? serviceId : '';
  const format = slotTimeFormatter(timezone);

  function clearResults() {
    setSlots(null);
    setError('');
    setSelectedSlot('');
  }

  async function consult(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending.current) return;
    clearResults();
    const parsed = slotsQuerySchema.safeParse({ serviceId: selected, date });
    if (!parsed.success) {
      setError('Elegí un servicio activo y una fecha válida.');
      return;
    }
    pending.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        serviceId: parsed.data.serviceId,
        date: parsed.data.date,
      });
      const response = await api<SlotsResponse>(`/api/slots?${params}`);
      setSlots(response.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }

  return (
    <Card component="section" aria-labelledby={headingId}>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Typography component="h2" variant="h2" id={headingId}>
              Consultar horarios
            </Typography>
            <Typography color="text.secondary">
              Elegí un servicio y una fecha para explorar la disponibilidad.
            </Typography>
            <Typography variant="body2" color="text.secondary" title={timezone}>
              Zona horaria del negocio: {timezoneCity(timezone)}
            </Typography>
          </Stack>
          {!active.length ? (
            <Alert severity="info">No hay servicios activos para consultar.</Alert>
          ) : (
            <Stack
              component="form"
              onSubmit={consult}
              aria-label="Consulta de horarios"
              aria-busy={loading}
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(0, 1fr)',
                  md: 'minmax(0, 1.5fr) minmax(0, 1fr) auto',
                },
                gap: 2,
                alignItems: 'start',
              }}
            >
              <TextField
                select
                fullWidth
                label="Servicio"
                value={selected}
                onChange={(event) => {
                  setServiceId(event.target.value);
                  clearResults();
                }}
                disabled={loading}
                required
              >
                {active.map((service) => (
                  <MenuItem key={service.id} value={service.id}>
                    {service.name} · {service.durationMinutes} min
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                label="Fecha"
                type="date"
                value={date}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(event) => {
                  setDate(event.target.value);
                  clearResults();
                }}
                disabled={loading}
                required
              />
              <Button
                type="submit"
                variant="contained"
                disabled={loading || !selected || !date}
                sx={{ minHeight: 56, px: 3 }}
              >
                {loading ? 'Consultando…' : 'Consultar'}
              </Button>
            </Stack>
          )}
          <Divider />
          <Box>
            <Box role="status" aria-live="polite" aria-atomic="true">
              {loading && (
                <Stack spacing={2} sx={{ py: 2 }}>
                  <Typography>Consultando horarios…</Typography>
                  <LinearProgress aria-label="Consultando horarios" />
                </Stack>
              )}
              {slots !== null && (
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 2 }}>
                  {slots.length}{' '}
                  {slots.length === 1 ? 'horario disponible' : 'horarios disponibles'}
                </Typography>
              )}
            </Box>
            {error && (
              <Alert
                severity="error"
                sx={{ flexWrap: 'wrap' }}
                action={
                  <Button
                    color="inherit"
                    onClick={() => void consult()}
                    disabled={loading || !selected || !date}
                    sx={{ minHeight: 44 }}
                  >
                    Reintentar
                  </Button>
                }
              >
                {error}
              </Alert>
            )}
            {slots?.length === 0 && (
              <Stack spacing={1} sx={{ p: 3, bgcolor: 'background.default', borderRadius: 2 }}>
                <Typography sx={{ fontWeight: 600 }}>No hay horarios disponibles.</Typography>
                <Typography variant="body2" color="text.primary">
                  Probá con otra fecha o servicio, o volvé a consultar.
                </Typography>
                <Button
                  variant="outlined"
                  onClick={() => void consult()}
                  sx={{ alignSelf: 'flex-start', minHeight: 44 }}
                >
                  Reintentar
                </Button>
              </Stack>
            )}
            {!!slots?.length && (
              <Stack spacing={3}>
                {[
                  { name: 'Mañana', matches: (hour: number) => hour < 12 },
                  { name: 'Tarde y noche', matches: (hour: number) => hour >= 12 },
                ].map((group) => {
                  const items = slots.filter((slot) =>
                    group.matches(Number(format.format(new Date(slot.startsAt)).split(':')[0])),
                  );
                  if (!items.length) return null;
                  return (
                    <Stack key={group.name} spacing={1.5}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography component="h3" variant="body2" sx={{ fontWeight: 600 }}>
                          {group.name}
                        </Typography>
                        <Chip
                          label={items.length}
                          size="small"
                          aria-label={`${items.length} horarios en ${group.name.toLowerCase()}`}
                        />
                      </Stack>
                      <Box
                        component="ul"
                        aria-label={`Horarios disponibles: ${group.name.toLowerCase()}`}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 160px), 1fr))',
                          gap: 1.5,
                          listStyle: 'none',
                          p: 0,
                          m: 0,
                        }}
                      >
                        {items.map((slot) => {
                          const { start, end } = slotToCalendarEvent(slot);
                          const key = `${start}/${end}`;
                          const isSelected = selectedSlot === key;
                          return (
                            <Box component="li" key={key}>
                              <Button
                                fullWidth
                                variant={isSelected ? 'contained' : 'outlined'}
                                aria-pressed={isSelected}
                                aria-describedby={noticeId}
                                disabled={loading}
                                onClick={() => setSelectedSlot(isSelected ? '' : key)}
                                sx={{
                                  minHeight: 52,
                                  whiteSpace: 'nowrap',
                                  fontVariantNumeric: 'tabular-nums',
                                  borderWidth: 2,
                                  borderColor: 'primary.main',
                                  '&:hover': {
                                    borderWidth: 2,
                                    bgcolor: isSelected ? 'primary.dark' : 'action.hover',
                                  },
                                  '&.Mui-focusVisible': {
                                    outline: '3px solid',
                                    outlineColor: 'primary.main',
                                    outlineOffset: 3,
                                  },
                                  '&.Mui-disabled': {
                                    borderColor: 'action.disabledBackground',
                                    color: 'action.disabled',
                                  },
                                }}
                              >
                                {format.format(new Date(start))} – {format.format(new Date(end))}
                                {isSelected && (
                                  <Box component="span" aria-hidden="true" sx={{ ml: 1 }}>
                                    ✓
                                  </Box>
                                )}
                              </Button>
                            </Box>
                          );
                        })}
                      </Box>
                    </Stack>
                  );
                })}
                <Typography role="status" variant="body2" color="primary.dark">
                  {selectedSlot
                    ? 'Horario seleccionado para consultar.'
                    : 'Seleccioná un horario para resaltarlo.'}
                </Typography>
              </Stack>
            )}
            {!loading && !error && slots === null && active.length > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                Los horarios disponibles aparecerán acá después de consultar.
              </Typography>
            )}
          </Box>
          <Typography id={noticeId} variant="body2" color="text.secondary">
            Consultar o seleccionar un horario no genera una reserva ni bloquea su disponibilidad.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
