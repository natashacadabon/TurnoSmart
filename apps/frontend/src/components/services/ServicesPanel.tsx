'use client';

import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RoomServiceRoundedIcon from '@mui/icons-material/RoomServiceRounded';
import {
  Alert,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  createServiceSchema,
  updateServiceSchema,
  type ServiceDto,
  type ServiceResponse,
} from '@turnosmart/shared';
import { useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/ui';
import { api, ApiError, errorMessage, fieldErrors } from '@/lib/api';

const priceFormat = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function serviceError(error: unknown) {
  if (error instanceof ApiError && error.code === 'SERVICE_NAME_CONFLICT') {
    return 'Ya existe un servicio con ese nombre.';
  }
  return errorMessage(error);
}

function ServiceDialog({
  service,
  onClose,
  onSaved,
}: {
  service: ServiceDto | null;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const [form, setForm] = useState({
    name: service?.name ?? '',
    description: service?.description ?? '',
    durationMinutes: service ? String(service.durationMinutes) : '',
    priceCents: service?.priceCents != null ? (service.priceCents / 100).toFixed(2) : '',
    active: service?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const price = form.priceCents.trim();
    const [units = '', cents = ''] = price.split(/[.,]/);
    const priceCents =
      price === ''
        ? null
        : /^\d+(?:[.,]\d{1,2})?$/.test(price)
          ? Number(units) * 100 + Number(cents.padEnd(2, '0'))
          : Number.NaN;
    const schema = service ? updateServiceSchema : createServiceSchema;
    const parsed = schema.safeParse({
      ...form,
      durationMinutes: /^\d+$/.test(form.durationMinutes)
        ? Number(form.durationMinutes)
        : Number.NaN,
      priceCents,
    });

    setErrors({});
    setError(null);
    if (!parsed.success) {
      const messages: Record<string, string> = {
        name: 'Ingresá un nombre de hasta 120 caracteres.',
        description: 'Ingresá hasta 2000 caracteres.',
        durationMinutes: 'Ingresá un número entero entre 1 y 1440.',
        priceCents: 'Ingresá un importe de 0 a 21.474.836,47 con hasta dos decimales.',
      };
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map(({ path, message }) => {
            const name = String(path[0]);
            return [name, messages[name] ?? message];
          }),
        ),
      );
      return;
    }

    setSaving(true);
    try {
      await api<ServiceResponse>(service ? `/api/services/${service.id}` : '/api/services', {
        method: service ? 'PATCH' : 'POST',
        body: parsed.data,
      });
      await onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(serviceError(err));
    } finally {
      setSaving(false);
    }
  }

  const field = (name: 'name' | 'description' | 'durationMinutes' | 'priceCents') => ({
    name,
    value: form[name],
    disabled: saving,
    error: Boolean(errors[name]),
    helperText: errors[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [name]: event.target.value }),
  });

  return (
    <Dialog
      open
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
    >
      <form onSubmit={submit} noValidate>
        <DialogTitle>{service ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Nombre" required autoFocus {...field('name')} />
            <TextField label="Descripción" multiline minRows={2} {...field('description')} />
            <TextField
              label="Duración (minutos)"
              required
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              {...field('durationMinutes')}
            />
            <TextField
              label="Precio"
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              {...field('priceCents')}
              helperText={
                errors.priceCents ?? 'Dejá vacío si el servicio no tiene un precio informado.'
              }
            />
            <FormControlLabel
              label="Servicio activo"
              control={
                <Switch
                  checked={form.active}
                  disabled={saving}
                  onChange={(_, active) => setForm({ ...form, active })}
                />
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function ServicesPanel({
  services,
  canWrite,
  onChanged,
}: {
  services: ServiceDto[];
  canWrite: boolean;
  onChanged(): Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<{ service: ServiceDto | null } | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase('es-AR');
  const visibleServices = services.filter((service) =>
    service.name.toLocaleLowerCase('es-AR').includes(normalizedQuery),
  );

  async function toggle(service: ServiceDto) {
    if (!canWrite || changing) return;
    setChanging(service.id);
    setError(null);
    try {
      await api<ServiceResponse>(`/api/services/${service.id}`, {
        method: 'PATCH',
        body: { active: !service.active },
      });
      await onChanged();
    } catch (err) {
      setError(serviceError(err));
    } finally {
      setChanging(null);
    }
  }

  return (
    <Card variant="outlined">
      <Stack spacing={2} sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between' }}
        >
          <Typography variant="h2">Catálogo de servicios</Typography>
          {canWrite && (
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              disabled={Boolean(changing)}
              onClick={() => setDialog({ service: null })}
            >
              Nuevo servicio
            </Button>
          )}
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        {services.length > 0 && (
          <TextField
            size="small"
            label="Buscar por nombre"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            sx={{ maxWidth: 340 }}
          />
        )}
        {visibleServices.length === 0 ? (
          <EmptyState
            icon={<RoomServiceRoundedIcon />}
            title={services.length ? 'No hay resultados' : 'Todavía no hay servicios'}
            description={services.length ? 'Probá con otro nombre.' : undefined}
          />
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Catálogo de servicios">
              <TableHead>
                <TableRow>
                  <TableCell>Nombre y descripción</TableCell>
                  <TableCell>Duración</TableCell>
                  <TableCell>Precio</TableCell>
                  <TableCell>Estado</TableCell>
                  {canWrite && <TableCell>Acciones</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleServices.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell
                      component="th"
                      scope="row"
                      sx={{ minWidth: 145, overflowWrap: 'anywhere' }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {service.name}
                      </Typography>
                      {service.description && (
                        <Typography variant="body2" color="text.secondary">
                          {service.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {service.durationMinutes} min
                    </TableCell>
                    <TableCell>
                      {service.priceCents == null
                        ? 'Sin precio'
                        : priceFormat.format(service.priceCents / 100)}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={service.active ? 'success' : 'default'}
                        label={service.active ? 'Activo' : 'Inactivo'}
                      />
                    </TableCell>
                    {canWrite && (
                      <TableCell>
                        <Stack direction="row">
                          <Button
                            size="small"
                            disabled={Boolean(changing)}
                            onClick={() => setDialog({ service })}
                          >
                            Editar
                          </Button>
                          <Button
                            size="small"
                            disabled={Boolean(changing)}
                            onClick={() => void toggle(service)}
                          >
                            {changing === service.id
                              ? 'Actualizando…'
                              : service.active
                                ? 'Desactivar'
                                : 'Activar'}
                          </Button>
                        </Stack>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>
      {canWrite && dialog && (
        <ServiceDialog
          service={dialog.service}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await onChanged();
          }}
        />
      )}
    </Card>
  );
}
