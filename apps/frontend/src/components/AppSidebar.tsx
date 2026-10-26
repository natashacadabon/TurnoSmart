'use client';

import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import QueryStatsRoundedIcon from '@mui/icons-material/QueryStatsRounded';
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import type { Role } from '@turnosmart/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { softDangerButtonSx } from './ui';
import styles from './AppSidebar.module.css';

/** Mismas secciones que el dashboard; Agenda, Predicciones y Reportes siguen siendo la vista demo de /. */
const NAV = [
  { href: '/', label: 'Agenda', icon: <CalendarMonthRoundedIcon fontSize="small" /> },
  { href: '/customers', label: 'Clientes', icon: <GroupsRoundedIcon fontSize="small" /> },
  { href: '/#riesgo', label: 'Predicciones IA', icon: <AutoAwesomeRoundedIcon fontSize="small" /> },
  { href: '/#reportes', label: 'Reportes', icon: <QueryStatsRoundedIcon fontSize="small" /> },
];

const ROLE_LABEL: Record<Role, string> = { OWNER: 'Dueño/a', ADMIN: 'Admin', STAFF: 'Staff' };

function isActive(href: string, pathname: string): boolean {
  if (href.includes('#')) return false;
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** Sidebar del dashboard, compartido por todas las pantallas. Abajo: cuenta y cierre de sesión. */
export function AppSidebar() {
  const pathname = usePathname();
  const { status, me, signOut } = useAuth();
  const onboarded = me?.onboarded ? me : null;
  const account = onboarded
    ? onboarded.profile.fullName || onboarded.user.email || 'Mi cuenta'
    : '';

  return (
    <aside className={styles.sidebar}>
      <Box>
        <Typography variant="h5" component="p" className={styles.brand}>
          TurnoSmart
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Agenda inteligente
        </Typography>
      </Box>

      <nav className={styles.nav} aria-label="Secciones principales">
        {NAV.map((item) => {
          const active = isActive(item.href, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? styles.navActive : undefined}
              aria-current={active ? 'page' : undefined}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className={styles.account}>
        {onboarded ? (
          <>
            <div className={styles.accountInfo}>
              <Typography className={styles.accountName} title={account}>
                {account}
              </Typography>
              <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', mt: 0.5, minWidth: 0 }}>
                <Chip size="small" variant="outlined" label={ROLE_LABEL[onboarded.profile.role]} />
                <Typography variant="body2" color="text.secondary" noWrap>
                  {onboarded.business.name}
                </Typography>
              </Stack>
            </div>
            <div className={styles.accountActions}>
              <Button
                component={Link}
                href="/settings"
                variant={pathname.startsWith('/settings') ? 'contained' : 'outlined'}
                size="small"
                startIcon={<StorefrontRoundedIcon />}
              >
                Negocio
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<LogoutRoundedIcon />}
                onClick={signOut}
                data-testid="logout"
                sx={softDangerButtonSx}
              >
                Cerrar sesión
              </Button>
            </div>
          </>
        ) : status === 'signedOut' ? (
          <Button
            component={Link}
            href="/login"
            variant="contained"
            size="small"
            startIcon={<LoginRoundedIcon />}
          >
            Ingresar
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
