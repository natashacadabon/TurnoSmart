'use client';

import RoomServiceRoundedIcon from '@mui/icons-material/RoomServiceRounded';
import {
  Alert,
  Box,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Tooltip,
  Button,
  Card,
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
  TablePagination,
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
import { MoreHorizontal, Pencil } from 'lucide-react';
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

export function ServiceDialog({
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
  onEdit,
  changing,
  onChanging: setChanging,
}: {
  services: ServiceDto[];
  canWrite: boolean;
  onChanged(): Promise<void>;
  onEdit(service: ServiceDto | null): void;
  changing: string | null;
  onChanging(id: string | null): void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; service: ServiceDto } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase('es-AR');
  const visibleServices = services.filter(
    (service) =>
      service.name.toLocaleLowerCase('es-AR').includes(normalizedQuery) &&
      (filter === 'all' || service.active === (filter === 'active')),
  );

  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(visibleServices.length / rowsPerPage) - 1),
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
    <Card component="section" aria-labelledby="service-catalog-title" sx={{ minWidth: 0 }}>
      <Stack spacing={1.5} sx={{ p: 2 }}>
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
        >
          <Typography id="service-catalog-title" component="h2" variant="h2" sx={{ fontSize: 17 }}>
            Catálogo de servicios
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {visibleServices.length} de {services.length}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label="Buscar por nombre"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            sx={{ flex: 1, minWidth: 0 }}
          />
          <TextField
            select
            size="small"
            label="Estado"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(0);
            }}
            sx={{ width: 120, flexShrink: 0 }}
          >
            <MenuItem value="all">Todos</MenuItem>
            <MenuItem value="active">Activos</MenuItem>
            <MenuItem value="inactive">Inactivos</MenuItem>
          </TextField>
        </Stack>
        {changing && <LinearProgress aria-label="Actualizando servicio" />}
        {error && <Alert severity="error">{error}</Alert>}
        {visibleServices.length === 0 ? (
          <Box sx={{ '& > .MuiStack-root': { py: 2 } }}>
            <EmptyState
              icon={<RoomServiceRoundedIcon />}
              title={services.length ? 'No hay resultados' : 'Todavía no hay servicios'}
              description={services.length ? 'Probá con otro nombre o estado.' : undefined}
            />
          </Box>
        ) : (
          <TableContainer>
            <Table
              size="small"
              aria-label="Catálogo de servicios"
              sx={{
                tableLayout: 'fixed',
                minWidth: 530,
                '& th, & td': { px: 0.75, py: 0.75, fontSize: 12 },
                '& th': { color: 'text.secondary' },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: '23%' }}>Nombre</TableCell>
                  <TableCell sx={{ width: '22%' }}>Descripción</TableCell>
                  <TableCell sx={{ width: '12%' }}>Duración</TableCell>
                  <TableCell sx={{ width: '14%' }}>Precio</TableCell>
                  <TableCell sx={{ width: '14%' }}>Estado</TableCell>
                  {canWrite && (
                    <TableCell align="right" sx={{ width: '15%' }}>
                      Acciones
                    </TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleServices
                  .slice(currentPage * rowsPerPage, (currentPage + 1) * rowsPerPage)
                  .map((service) => (
                    <TableRow key={service.id} hover>
                      <TableCell component="th" scope="row">
                        <Tooltip title={service.name} describeChild>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary' }}
                          >
                            {service.name}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={service.description ?? 'Sin descripción'} describeChild>
                          <Typography noWrap sx={{ fontSize: 12 }} color="text.secondary">
                            {service.description || '—'}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {service.durationMinutes} min
                      </TableCell>
                      <TableCell sx={{ overflowWrap: 'anywhere' }}>
                        {service.priceCents == null
                          ? 'Sin precio'
                          : priceFormat.format(service.priceCents / 100)}
                      </TableCell>
                      <TableCell>
                        <Box
                          component="span"
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.5,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <Box
                            component="span"
                            aria-hidden
                            sx={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              bgcolor: service.active ? 'success.main' : 'text.disabled',
                            }}
                          />
                          {service.active ? 'Activo' : 'Inactivo'}
                        </Box>
                      </TableCell>
                      {canWrite && (
                        <TableCell align="right">
                          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                            <Tooltip title="Editar servicio">
                              <span>
                                <IconButton
                                  size="small"
                                  aria-label={`Editar ${service.name}`}
                                  disabled={Boolean(changing)}
                                  onClick={() => onEdit(service)}
                                >
                                  <Pencil size={16} />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title="Más acciones">
                              <span>
                                <IconButton
                                  size="small"
                                  aria-label={`Más acciones de ${service.name}`}
                                  aria-haspopup="menu"
                                  aria-expanded={menu?.service.id === service.id ? true : undefined}
                                  aria-controls={
                                    menu?.service.id === service.id
                                      ? 'service-actions-menu'
                                      : undefined
                                  }
                                  disabled={Boolean(changing)}
                                  onClick={(event) =>
                                    setMenu({ anchor: event.currentTarget, service })
                                  }
                                >
                                  <MoreHorizontal size={17} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {visibleServices.length > 5 && (
          <TablePagination
            component="div"
            count={visibleServices.length}
            page={currentPage}
            rowsPerPage={rowsPerPage}
            rowsPerPageOptions={[5, 10, 25]}
            labelRowsPerPage="Filas"
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
            getItemAriaLabel={(type) =>
              type === 'next'
                ? 'Página siguiente'
                : type === 'previous'
                  ? 'Página anterior'
                  : type === 'first'
                    ? 'Primera página'
                    : 'Última página'
            }
            onPageChange={(_, next) => setPage(next)}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value));
              setPage(0);
            }}
            sx={{
              '& .MuiTablePagination-toolbar': { px: 0, minHeight: 36, flexWrap: 'wrap' },
              '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
                fontSize: 12,
              },
              '& .MuiTablePagination-actions': { ml: 1 },
            }}
          />
        )}
      </Stack>
      <Menu
        id="service-actions-menu"
        anchorEl={menu?.anchor}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
      >
        <MenuItem
          disabled={Boolean(changing)}
          onClick={() => {
            if (menu) void toggle(menu.service);
            setMenu(null);
          }}
        >
          {menu?.service.active ? 'Desactivar servicio' : 'Activar servicio'}
        </MenuItem>
      </Menu>
    </Card>
  );
}
