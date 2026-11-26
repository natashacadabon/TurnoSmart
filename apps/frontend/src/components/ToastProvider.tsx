'use client';

import { Alert, Button, IconButton, Snackbar, useMediaQuery, type AlertColor } from '@mui/material';
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const icons = { success: CircleCheck, error: CircleX, warning: TriangleAlert, info: Info };
type ToastAction = { label: string; onClick(): boolean | void | Promise<boolean | void> };
type ToastOptions = { action?: ToastAction; key?: string; enqueue?: boolean };
type Notify = (message: string, severity?: AlertColor, options?: ToastOptions) => void;
type Toast = {
  id: number;
  message: string;
  severity: AlertColor;
  open: boolean;
  options?: ToastOptions;
};
const ToastContext = createContext<{
  notify: Notify;
  dismiss(): void;
  setPaused(paused: boolean): void;
} | null>(null);

export function useToastState() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const notify = useCallback<Notify>((message, severity = 'success', options) => {
    const id = ++nextId.current;
    setToasts((previous) => {
      if (options?.key && previous.some((item) => item.open && item.options?.key === options.key))
        return previous;
      if (
        !options?.key &&
        previous[0]?.open &&
        previous[0].message === message &&
        previous[0].severity === severity
      )
        return previous;
      const next = { id, message, severity, open: true, options };
      if (options?.enqueue) return [...previous.filter((item) => item.open), next];
      return [
        next,
        ...previous.filter((item, index) => item.open && (index > 0 || item.options?.enqueue)),
      ];
    });
  }, []);
  const dismiss = useCallback((id?: number) => {
    setToasts((previous) => {
      if (!previous[0]?.open || (id !== undefined && previous[0].id !== id)) return previous;
      return previous.length > 1 ? previous.slice(1) : [{ ...previous[0], open: false }];
    });
  }, []);
  return { toast: toasts[0] ?? null, notify, dismiss };
}

export function ToastViewport({
  toast,
  dismiss,
}: {
  toast: Toast | null;
  dismiss(id: number): void;
}) {
  const [acting, setActing] = useState<number | null>(null);
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
      autoHideDuration={
        urgent ? null : toast.options?.action ? 10000 : toast.severity === 'success' ? 4500 : 6000
      }
      transitionDuration={reduceMotion ? 0 : { enter: 180, exit: 140 }}
      onClose={(_, reason) => {
        if (reason !== 'clickaway') close();
      }}
      sx={{ maxWidth: { sm: 460 }, top: '64px !important' }}
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
        {toast.options?.action && (
          <Button
            size="small"
            color="inherit"
            disabled={acting === toast.id}
            sx={{ display: 'block', mt: 0.5, px: 0, textDecoration: 'underline' }}
            onClick={async () => {
              const action = toast.options?.action;
              if (!action || acting === toast.id) return;
              setActing(toast.id);
              try {
                if ((await action.onClick()) !== false) dismiss(toast.id);
              } finally {
                setActing(null);
              }
            }}
          >
            {acting === toast.id ? 'Abriendo…' : toast.options.action.label}
          </Button>
        )}
      </Alert>
    </Snackbar>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toast, notify, dismiss } = useToastState();
  const [paused, setPaused] = useState(false);
  const controls = useMemo(() => ({ notify, dismiss, setPaused }), [notify, dismiss]);
  return (
    <ToastContext.Provider value={controls}>
      {children}
      <ToastViewport toast={paused ? null : toast} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const controls = useContext(ToastContext);
  if (!controls) throw new Error('useToast requiere ToastProvider');
  return controls;
}
