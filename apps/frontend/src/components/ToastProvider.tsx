'use client';

import { Alert, IconButton, Snackbar, useMediaQuery, type AlertColor } from '@mui/material';
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const icons = { success: CircleCheck, error: CircleX, warning: TriangleAlert, info: Info };
type Notify = (message: string, severity?: AlertColor) => void;
type Toast = { id: number; message: string; severity: AlertColor; open: boolean };
const ToastContext = createContext<{ notify: Notify; dismiss(): void } | null>(null);

export function useToastState() {
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = useCallback<Notify>((message, severity = 'success') => {
    setToast((previous) =>
      previous?.open && previous.message === message && previous.severity === severity
        ? previous
        : { id: (previous?.id ?? 0) + 1, message, severity, open: true },
    );
  }, []);
  const dismiss = useCallback((id?: number) => {
    setToast((previous) =>
      previous?.open && (id === undefined || previous.id === id)
        ? { ...previous, open: false }
        : previous,
    );
  }, []);
  return { toast, notify, dismiss };
}

export function ToastViewport({
  toast,
  dismiss,
}: {
  toast: Toast | null;
  dismiss(id: number): void;
}) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (!toast) return null;
  const Icon = icons[toast.severity];
  const urgent = toast.severity === 'error' || toast.severity === 'warning';
  const close = () => dismiss(toast.id);
  return (
    <Snackbar
      key={toast.id}
      open={toast.open}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      autoHideDuration={urgent ? null : toast.severity === 'success' ? 4500 : 6000}
      transitionDuration={reduceMotion ? 0 : { enter: 180, exit: 140 }}
      onClose={(_, reason) => {
        if (reason !== 'clickaway') close();
      }}
      sx={{ maxWidth: { sm: 420 } }}
    >
      <Alert
        severity={toast.severity}
        role={urgent ? 'alert' : 'status'}
        aria-live={urgent ? undefined : 'polite'}
        aria-atomic="true"
        icon={<Icon size={19} aria-hidden />}
        action={
          <IconButton color="inherit" size="small" aria-label="Cerrar notificación" onClick={close}>
            <X size={18} aria-hidden />
          </IconButton>
        }
        sx={{ width: '100%', alignItems: 'center', boxShadow: 4, overflowWrap: 'anywhere' }}
      >
        {toast.message}
      </Alert>
    </Snackbar>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toast, notify, dismiss } = useToastState();
  const controls = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);
  return (
    <ToastContext.Provider value={controls}>
      {children}
      <ToastViewport toast={toast} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const controls = useContext(ToastContext);
  if (!controls) throw new Error('useToast requiere ToastProvider');
  return controls;
}
