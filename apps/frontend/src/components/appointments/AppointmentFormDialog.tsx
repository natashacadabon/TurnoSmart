'use client';

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  createAppointmentSchema,
  type AppointmentDto,
  type CustomerDto,
  type Paginated,
  type ServiceDto,
} from '@turnosmart/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CustomerFormDialog } from '@/components/CustomerFormDialog';
import { api, ApiError, errorMessage, fieldErrors } from '@/lib/api';
import { slotTimeFormatter } from '@/lib/calendar-events';
import { listAgendaServices } from '@/lib/agenda-data';
import { AppointmentSlotPicker, useAppointmentSlots } from './AppointmentSlotPicker';

interface Props {
  timezone: string;
  initialDate?: string;
  initialStartsAt?: string;
  onClose(): void;
  onSaved(appointment: AppointmentDto, title: string): void;
}

/** Se monta al abrir: la selección de calendario sólo sugiere un slot del backend. */
export function AppointmentFormDialog({
  timezone,
  initialDate,
  initialStartsAt,
  onClose,
  onSaved,
}: Props) {
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [services, setServices] = useState<ServiceDto[] | null>(null);
  const [servicesError, setServicesError] = useState('');
  const [serviceRetry, setServiceRetry] = useState(0);
  const [serviceId, setServiceId] = useState('');
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<{
    query: string;
    page: number;
    items: CustomerDto[];
    total: number;
  } | null>(null);
  const [customersError, setCustomersError] = useState('');
  const [customerRetry, setCustomerRetry] = useState(0);
  const [newCustomer, setNewCustomer] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const format = slotTimeFormatter(timezone);
  const slots = useAppointmentSlots({ timezone, serviceId, initialDate, initialStartsAt });
  const { selected } = slots;
  const service = services?.find((item) => item.id === serviceId);
  const customersLoading = customers?.query !== search || customers.page !== page;
  const options = customers?.query === search ? customers.items : [];
  const customerOptions =
    customer && !options.some((item) => item.id === customer.id) ? [customer, ...options] : options;

  useEffect(() => {
    let active = true;
    async function load() {
      const all = (await listAgendaServices('true', () => active)).filter((item) => item.active);
      if (active) {
        setServices(all);
        setServicesError('');
      }
    }
    void load().catch((err) => {
      if (active) setServicesError(errorMessage(err));
    });
    return () => {
      active = false;
    };
  }, [serviceRetry]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ search, page: String(page), pageSize: '50' });
      api<Paginated<CustomerDto>>(`/api/customers?${params}`).then(
        (result) => {
          if (!active) return;
          setCustomers((previous) => ({
            query: search,
            page,
            total: result.total,
            items:
              page > 1 && previous?.query === search
                ? [
                    ...previous.items,
                    ...result.items.filter(
                      (item) => !previous.items.some((old) => old.id === item.id),
                    ),
                  ]
                : result.items,
          }));
          setCustomersError('');
        },
        (err) => {
          if (active) setCustomersError(errorMessage(err));
        },
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, page, customerRetry]);

  function close() {
    if (!pending.current) onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !customer || !service || !selected) return;
    const parsed = createAppointmentSchema.safeParse({
      customerId: customer.id,
      serviceId,
      startsAt: selected.startsAt,
      notes,
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
        ),
      );
      return;
    }
    pending.current = true;
    setSaving(true);
    setError('');
    setErrors({});
    let saved: AppointmentDto;
    try {
      saved = await api<AppointmentDto>('/api/appointments', {
        method: 'POST',
        body: parsed.data,
      });
    } catch (err) {
      setErrors(fieldErrors(err));
      if (err instanceof ApiError && err.status === 409) {
        setError(
          'La disponibilidad cambió. Revisá el servicio y elegí nuevamente un horario antes de confirmar.',
        );
        slots.refresh();
        if (err.code === 'SERVICE_INACTIVE') {
          setServiceId('');
          setServices(null);
          setServiceRetry((value) => value + 1);
        }
      } else setError(errorMessage(err));
      return;
    } finally {
      pending.current = false;
      setSaving(false);
    }
    onSaved(saved, `${customer.fullName} · ${service.name}`);
  }

  return (
    <>
      <Dialog
        open
        onClose={close}
        fullWidth
        maxWidth="sm"
        fullScreen={fullScreen}
        aria-labelledby="new-appointment-title"
      >
        <Box
          component="form"
          onSubmit={submit}
          noValidate
          aria-busy={saving}
          sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <DialogTitle id="new-appointment-title">
            Nuevo turno
            <Typography variant="body2" color="text.secondary">
              Elegí un cliente y un horario disponible para tu servicio.
            </Typography>
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2.5}>
              <Typography variant="body2" color="text.secondary">
                Horarios del negocio · {timezone}
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}
              <Stack spacing={1}>
                <Typography component="h2" variant="h2">
                  Cliente y servicio
                </Typography>
                <Autocomplete
                  options={customerOptions}
                  value={customer}
                  disabled={saving}
                  loading={customersLoading && !customersError}
                  filterOptions={(items) => items}
                  getOptionLabel={(item) => item.fullName}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  noOptionsText="No se encontraron clientes"
                  loadingText="Buscando clientes…"
                  onChange={(_, value) => {
                    setCustomer(value);
                    setErrors((old) => ({ ...old, customerId: '' }));
                  }}
                  onInputChange={(_, value, reason) => {
                    if (reason === 'input' || reason === 'clear') {
                      setSearch(value);
                      setPage(1);
                      setCustomersError('');
                    }
                  }}
                  renderOption={(props, item) => {
                    const { key, ...rest } = props;
                    return (
                      <li key={key} {...rest}>
                        <Stack>
                          <span>{item.fullName}</span>
                          <Typography variant="caption" color="text.secondary">
                            {item.email ?? item.phone ?? 'Sin datos de contacto'}
                          </Typography>
                        </Stack>
                      </li>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Cliente"
                      required
                      autoFocus
                      error={!!errors.customerId}
                      helperText={
                        errors.customerId
                          ? 'Seleccioná un cliente.'
                          : 'Buscá por nombre, email o teléfono.'
                      }
                    />
                  )}
                />
                {customersError && (
                  <Alert
                    severity="error"
                    action={
                      <Button
                        disabled={saving}
                        onClick={() => {
                          setCustomersError('');
                          setCustomerRetry((value) => value + 1);
                        }}
                      >
                        Reintentar
                      </Button>
                    }
                  >
                    {customersError}
                  </Alert>
                )}
                <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                  <Button size="small" onClick={() => setNewCustomer(true)} disabled={saving}>
                    Crear cliente
                  </Button>
                  {customers?.query === search && customers.items.length < customers.total && (
                    <Button
                      size="small"
                      disabled={saving || customersLoading}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      Cargar más clientes
                    </Button>
                  )}
                </Stack>
                {servicesError ? (
                  <Alert
                    severity="error"
                    action={
                      <Button
                        onClick={() => {
                          setServicesError('');
                          setServiceRetry((value) => value + 1);
                        }}
                      >
                        Reintentar
                      </Button>
                    }
                  >
                    {servicesError}
                  </Alert>
                ) : services === null ? (
                  <LinearProgress aria-label="Cargando servicios" />
                ) : services.length === 0 ? (
                  <Alert severity="info">
                    No hay servicios activos. Activá o creá uno en Servicios para registrar un
                    turno.
                  </Alert>
                ) : (
                  <TextField
                    select
                    label="Servicio"
                    required
                    value={serviceId}
                    disabled={saving}
                    error={!!errors.serviceId}
                    helperText={
                      service
                        ? `Duración del servicio: ${service.durationMinutes} minutos`
                        : errors.serviceId
                          ? 'Seleccioná un servicio activo.'
                          : 'Sólo se muestran servicios activos.'
                    }
                    onChange={(event) => {
                      setServiceId(event.target.value);
                      slots.clearServiceSelection();
                      setErrors((old) => ({ ...old, serviceId: '', startsAt: '' }));
                    }}
                  >
                    {services.map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.name} · {item.durationMinutes} min
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              </Stack>
              <Divider />
              <AppointmentSlotPicker
                slots={slots}
                disabled={saving}
                error={errors.startsAt}
                onEdit={() => setErrors((old) => ({ ...old, startsAt: '' }))}
              />
              <TextField
                label="Observaciones (opcional)"
                multiline
                minRows={2}
                value={notes}
                disabled={saving}
                error={!!errors.notes}
                helperText={errors.notes ?? `${notes.length}/1000 caracteres`}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
                onChange={(event) => setNotes(event.target.value)}
              />
              <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 2 }} aria-live="polite">
                <Stack spacing={1}>
                  <Typography component="h2" variant="h2">
                    Resumen del turno
                  </Typography>
                  <Typography>
                    {customer?.fullName ?? 'Elegí un cliente'} ·{' '}
                    {service?.name ?? 'Elegí un servicio'}
                  </Typography>
                  {selected ? (
                    <>
                      <Typography>
                        {new Intl.DateTimeFormat('es-AR', {
                          timeZone: timezone,
                          dateStyle: 'full',
                        }).format(new Date(selected.startsAt))}
                      </Typography>
                      <Chip
                        sx={{ alignSelf: 'flex-start' }}
                        color="primary"
                        variant="outlined"
                        label={`${format.format(new Date(selected.startsAt))} – ${format.format(new Date(selected.endsAt))} · ${(Date.parse(selected.endsAt) - Date.parse(selected.startsAt)) / 60000} min`}
                      />
                    </>
                  ) : (
                    <Typography color="text.secondary">
                      Seleccioná un horario para ver el inicio y el fin.
                    </Typography>
                  )}
                </Stack>
              </Box>
              <Typography variant="caption" color="text.secondary">
                La disponibilidad se vuelve a validar al confirmar. Elegir un horario no lo reserva.
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={close} disabled={saving}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={saving || !customer || !service || !selected}
            >
              {saving ? 'Guardando…' : 'Confirmar turno'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
      {newCustomer && (
        <CustomerFormDialog
          open
          customer={null}
          onClose={() => setNewCustomer(false)}
          onSaved={(saved) => {
            setCustomer(saved);
            setNewCustomer(false);
            setErrors((old) => ({ ...old, customerId: '' }));
          }}
        />
      )}
    </>
  );
}
