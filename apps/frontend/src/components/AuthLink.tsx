'use client';

import { Link as MuiLink } from '@mui/material';
import NextLink from 'next/link';
import type { ReactNode } from 'react';

/**
 * Link de las pantallas de acceso. globals.css quita color y subrayado a todos los <a>, así que
 * acá se marca explícitamente para que no parezca texto normal.
 */
export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <MuiLink
      component={NextLink}
      href={href}
      color="primary"
      underline="always"
      sx={{
        fontWeight: 600,
        textUnderlineOffset: '3px',
        '&:hover': { color: 'primary.dark' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', borderRadius: 1 },
      }}
    >
      {children}
    </MuiLink>
  );
}
