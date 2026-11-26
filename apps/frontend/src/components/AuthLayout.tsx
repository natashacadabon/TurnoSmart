'use client';

import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { Brand } from './ui';

/** Pantallas sin sesión: tarjeta centrada sobre el fondo del dashboard. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: { xs: 2.5, sm: 4 },
        bgcolor: 'background.default',
      }}
    >
      <Stack sx={{ width: '100%', maxWidth: 420, gap: 3 }}>
        <Brand />
        <Card>
          <CardContent
            sx={{ p: { xs: 2.5, sm: 3.5 }, '&:last-child': { pb: { xs: 2.5, sm: 3.5 } } }}
          >
            {children}
          </CardContent>
        </Card>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
          UTN FRLP · Desarrollo de Software Cloud 2026
        </Typography>
      </Stack>
    </Box>
  );
}
