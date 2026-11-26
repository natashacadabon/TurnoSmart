'use client';

import { Avatar, Box, Stack, Typography, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';

/** Rojo suave del dashboard (mismos tonos que el chip "Riesgo alto"), para acciones como cerrar sesión. */
export const softDangerButtonSx: SxProps<Theme> = {
  color: '#b91c1c',
  bgcolor: '#fef2f2',
  borderColor: '#fecaca',
  '&:hover': { bgcolor: '#fee2e2', borderColor: '#fca5a5' },
};

/** Marca en texto, igual que el sidebar del dashboard. */
export function Brand() {
  return (
    <Box>
      <Typography
        variant="h5"
        component="p"
        sx={{ color: 'text.primary', fontWeight: 750, letterSpacing: 0 }}
      >
        TurnoSmart
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Agenda inteligente
      </Typography>
    </Box>
  );
}

/** Encabezado con el mismo formato que "Agenda de hoy" del dashboard. */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  const { me } = useAuth();
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      sx={{ justifyContent: 'space-between', gap: 2.5, alignItems: { md: 'flex-start' } }}
    >
      <Box sx={{ maxWidth: 620 }}>
        {back}
        {me?.onboarded && <Typography variant="overline">{me.business.name}</Typography>}
        <Typography variant="h1">{title}</Typography>
        {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
      </Box>
      {actions && (
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', py: 6, px: 2 }}>
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'action.hover',
          color: 'text.secondary',
          '& svg': { fontSize: 28 },
        }}
      >
        {icon}
      </Box>
      <Typography variant="h2">{title}</Typography>
      {description && (
        <Typography color="text.secondary" sx={{ maxWidth: 380 }}>
          {description}
        </Typography>
      )}
      {action}
    </Stack>
  );
}

const AVATAR_COLORS = ['#2563EB', '#7C3AED', '#C2410C', '#0369A1', '#BE185D', '#4D7C0F', '#A16207'];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() ||
    '?'
  );
}

/** Avatar con iniciales y un color estable derivado del nombre. */
export function NameAvatar({
  name,
  size = 36,
  sx,
}: {
  name: string;
  size?: number;
  sx?: SxProps<Theme>;
}) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <Avatar
      sx={[
        {
          width: size,
          height: size,
          fontSize: size * 0.38,
          fontWeight: 700,
          color: '#fff',
          bgcolor: AVATAR_COLORS[hash % AVATAR_COLORS.length],
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {initials(name)}
    </Avatar>
  );
}
