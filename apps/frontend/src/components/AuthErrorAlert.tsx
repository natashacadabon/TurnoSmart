'use client';

import { Alert } from '@mui/material';
import type { ReactNode } from 'react';

/**
 * Error de un formulario de acceso. Con borde y texto rojo fuerte para que se distinga del fondo
 * claro de la tarjeta; role="alert" lo anuncia a lectores de pantalla.
 */
export function AuthErrorAlert({ children }: { children: ReactNode }) {
  return (
    <Alert
      severity="error"
      variant="outlined"
      role="alert"
      sx={{
        bgcolor: 'error.light',
        borderColor: 'error.main',
        borderWidth: 1.5,
        color: 'error.main',
        fontWeight: 600,
        '& .MuiAlert-icon': { color: 'error.main' },
      }}
    >
      {children}
    </Alert>
  );
}
