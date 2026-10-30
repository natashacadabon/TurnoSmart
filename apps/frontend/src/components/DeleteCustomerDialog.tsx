'use client';

import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import type { CustomerDto } from '@turnosmart/shared';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';

interface Props {
  customer: CustomerDto;
  onClose(): void;
  onDeleted(): void;
}

/** Confirmación de baja definitiva. Si el cliente tiene turnos, la API responde 409 y se muestra el motivo. */
export function DeleteCustomerDialog({ customer, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await api<void>(`/api/customers/${customer.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
    }
  }

  return (
    <Dialog open onClose={deleting ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Eliminar cliente</DialogTitle>
      <DialogContent>
        <Typography>
          ¿Eliminar a <strong>{customer.fullName}</strong>? Se borra definitivamente y no se puede
          deshacer.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Un cliente con turnos registrados no se puede eliminar, para conservar su historial.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={deleting}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={confirm}
          disabled={deleting}
          startIcon={
            deleting ? <CircularProgress size={14} color="inherit" /> : <DeleteOutlineRoundedIcon />
          }
        >
          Eliminar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
