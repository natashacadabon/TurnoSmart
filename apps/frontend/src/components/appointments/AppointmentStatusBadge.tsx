import { Box, Chip } from '@mui/material';
import type { AppointmentStatus } from '@turnosmart/shared';
import { appointmentStates } from '@/lib/agenda';

export function AppointmentStatusIcon({
  status,
  inEvent = false,
}: {
  status: AppointmentStatus;
  inEvent?: boolean;
}) {
  const { icon: Icon, color, background } = appointmentStates[status];
  return (
    <Icon
      size={inEvent ? 13 : 15}
      color={color}
      strokeWidth={2.25}
      aria-hidden="true"
      focusable="false"
      style={{
        flexShrink: 0,
        ...(inEvent
          ? { backgroundColor: background, borderRadius: 3, boxSizing: 'content-box', padding: 1 }
          : {}),
      }}
    />
  );
}

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const state = appointmentStates[status];
  return (
    <Chip
      size="small"
      label={
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <AppointmentStatusIcon status={status} />
          <span>{state.label}</span>
        </Box>
      }
      sx={{ color: state.color, bgcolor: state.background, fontWeight: 600 }}
    />
  );
}
