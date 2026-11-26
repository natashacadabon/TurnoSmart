'use client';

import { Breadcrumbs, Link, Typography } from '@mui/material';
import NextLink from 'next/link';
import { useUnsavedChanges } from '@/components/UnsavedChangesProvider';

export function PageBreadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  const { allowNavigation } = useUnsavedChanges();
  return (
    <Breadcrumbs aria-label="Ruta de navegación" separator=">" sx={{ fontSize: '0.8125rem' }}>
      {items.map((item) =>
        item.href ? (
          <Link
            key={item.label}
            component={NextLink}
            href={item.href}
            color="text.secondary"
            underline="hover"
            onNavigate={(event) => {
              if (!allowNavigation()) event.preventDefault();
            }}
          >
            {item.label}
          </Link>
        ) : (
          <Typography
            key={item.label}
            component="span"
            aria-current="page"
            sx={{ fontSize: 'inherit' }}
          >
            {item.label}
          </Typography>
        ),
      )}
    </Breadcrumbs>
  );
}
