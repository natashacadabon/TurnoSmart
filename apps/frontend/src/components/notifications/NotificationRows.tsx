'use client';

import { Box, Button, Stack, Typography } from '@mui/material';
import type {
  NotificationDto,
  NotificationKind,
  NotificationReadResponse,
} from '@turnosmart/shared';
import { BadgeCheck, CalendarClock, CheckCircle2, CircleX, Clock3, UserX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';
import { useNotifications } from './NotificationProvider';

const kinds: Record<
  NotificationKind,
  {
    title: string;
    description: string;
    icon: typeof Clock3;
    color: string;
  }
> = {
  APPOINTMENT_UPCOMING: {
    title: 'Turno próximo',
    description: 'Revisá el próximo turno de la agenda.',
    icon: Clock3,
    color: 'info.main',
  },
  CONFIRMED: {
    title: 'Turno confirmado',
    description: 'Se confirmó la reserva.',
    icon: BadgeCheck,
    color: 'success.main',
  },
  CANCELLED: {
    title: 'Turno cancelado',
    description: 'Se liberó el horario reservado.',
    icon: CircleX,
    color: 'warning.main',
  },
  RESCHEDULED: {
    title: 'Turno reprogramado',
    description: 'Se guardó un nuevo horario.',
    icon: CalendarClock,
    color: 'info.main',
  },
  MARKED_NO_SHOW: {
    title: 'Turno marcado como ausente',
    description: 'Se registró una ausencia.',
    icon: UserX,
    color: 'error.main',
  },
  COMPLETED: {
    title: 'Turno completado',
    description: 'Se registró el turno como completado.',
    icon: CheckCircle2,
    color: 'success.main',
  },
};

export function NotificationRows({
  items,
  timezone,
  onRead,
  onNavigate,
}: {
  items: NotificationDto[];
  timezone: string;
  onRead?(id: string, result: NotificationReadResponse): void;
  onNavigate?(): void;
}) {
  const format = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: timezone,
  });
  return (
    <Stack component="ul" aria-label="Notificaciones" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {items.map((item) => (
        <NotificationRow
          key={item.id}
          item={item}
          format={format}
          onRead={onRead}
          onNavigate={onNavigate}
        />
      ))}
    </Stack>
  );
}

function NotificationRow({
  item,
  format,
  onRead,
  onNavigate,
}: {
  item: NotificationDto;
  format: Intl.DateTimeFormat;
  onRead?: ((id: string, result: NotificationReadResponse) => void) | undefined;
  onNavigate?: (() => void) | undefined;
}) {
  const router = useRouter();
  const { markRead } = useNotifications();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const { icon: Icon, title, description, color } = kinds[item.kind];
  const isUnread = !item.readAt;

  async function act(navigate: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (isUnread) {
        const result = await markRead(item.id);
        onRead?.(item.id, result);
      }
      if (navigate && item.appointmentId) {
        onNavigate?.();
        router.push('/appointments/' + item.appointmentId);
      } else {
        notify('Notificación marcada como leída');
      }
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Stack
      component="li"
      direction="row"
      sx={{
        gap: 1,
        p: 1.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: isUnread ? 'info.light' : 'background.paper',
      }}
    >
      <Box sx={{ color, display: 'flex', pt: 0.3 }}>
        <Icon size={18} aria-hidden />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          {isUnread && (
            <Box
              aria-hidden
              sx={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                flexShrink: 0,
              }}
            />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {description} Horario: {format.format(new Date(item.startsAt))}.
        </Typography>
        <Typography variant="caption" color="text.secondary">
          <time dateTime={item.createdAt}>{format.format(new Date(item.createdAt))}</time> ·{' '}
          {isUnread ? 'No leída' : 'Leída'}
        </Typography>
        <Stack direction="row" sx={{ mt: 0.25, ml: -0.75, flexWrap: 'wrap' }}>
          {item.appointmentId ? (
            <Button size="small" disabled={busy} onClick={() => void act(true)}>
              Ver turno
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ px: 0.75, py: 1 }}>
              Turno no disponible
            </Typography>
          )}
          {isUnread && (
            <Button size="small" color="inherit" disabled={busy} onClick={() => void act(false)}>
              Marcar como leída
            </Button>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
