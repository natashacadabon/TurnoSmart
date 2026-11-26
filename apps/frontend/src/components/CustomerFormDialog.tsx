'use client';

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { CreateCustomerRequest, CustomerDto } from '@turnosmart/shared';
import { useState, type FormEvent } from 'react';
import { api, errorMessage, fieldErrors } from '@/lib/api';

interface Props {
  open: boolean;
  /** Cliente a editar; null para alta. */
  customer: CustomerDto | null;
  onClose(): void;
  onSaved(customer: CustomerDto): void;
}

const empty = { fullName: '', email: '', phone: '', notes: '' };

/** Formulario reutilizable para alta y edición de clientes. */
export function CustomerFormDialog({ open, customer, onClose, onSaved }: Props) {
  // Se monta al abrirse: el estado inicial sale del cliente a editar.
  const [form, setForm] = useState(() =>
    customer
      ? {
          fullName: customer.fullName,
          email: customer.email ?? '',
          phone: customer.phone ?? '',
          notes: customer.notes ?? '',
        }
      : empty,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setError(null);
    try {
      const body: CreateCustomerRequest = form;
      const saved = customer
        ? await api<CustomerDto>(`/api/customers/${customer.id}`, { method: 'PATCH', body })
        : await api<CustomerDto>('/api/customers', { method: 'POST', body });
      onSaved(saved);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const field = (name: keyof typeof empty) => ({
    name,
    value: form[name],
    error: !!errors[name],
    helperText: errors[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [name]: e.target.value }),
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      {/* noValidate: los errores los muestra el servidor junto a cada campo, en español. */}
      <form onSubmit={onSubmit} noValidate>
        <DialogTitle>
          {customer ? 'Editar cliente' : 'Nuevo cliente'}
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
            Sólo el nombre es obligatorio.
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Nombre y apellido" required autoFocus {...field('fullName')} />
            <TextField label="Email" type="email" {...field('email')} />
            <TextField
              label="Teléfono"
              placeholder="+54 221 555-1234"
              slotProps={{ htmlInput: { inputMode: 'tel', autoComplete: 'tel' } }}
              {...field('phone')}
            />
            <TextField label="Notas" multiline minRows={2} {...field('notes')} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
