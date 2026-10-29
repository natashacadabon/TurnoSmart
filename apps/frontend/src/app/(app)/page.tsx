'use client';

import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import QueryStatsRoundedIcon from '@mui/icons-material/QueryStatsRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import type { CustomerDto, Paginated } from '@turnosmart/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { EmptyState } from '@/components/ui';
import { api } from '@/lib/api';
import styles from '../page.module.css';

/**
 * Agenda del negocio con el diseño del dashboard (/demo), sólo con datos reales.
 * Turnos, riesgo y reportes llegan con la agenda de C (C02/C08); hasta entonces se muestran vacíos.
 */
export default function AgendaPage() {
  const { me } = useAuth();
  const [customers, setCustomers] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    api<Paginated<CustomerDto>>('/api/customers?pageSize=1').then(
      (result) => {
        if (active) setCustomers(result.total);
      },
      () => {
        // Sin el total se muestra "—": la agenda sigue usable.
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (!me?.onboarded) return null;

  const today = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: me.business.timezone,
  }).format(new Date());

  const metrics: { label: string; value: string; icon: ReactNode }[] = [
    { label: 'Turnos hoy', value: '—', icon: <CalendarMonthRoundedIcon /> },
    {
      label: 'Clientes',
      value: customers === null ? '—' : String(customers),
      icon: <GroupsRoundedIcon />,
    },
    { label: 'Riesgo alto', value: '—', icon: <WarningAmberRoundedIcon /> },
    { label: 'Emails enviados', value: '—', icon: <MailOutlineRoundedIcon /> },
  ];

  return (
    <>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{ justifyContent: 'space-between', gap: 2.5, alignItems: { md: 'flex-start' } }}
      >
        <Box className={styles.heading}>
          <Typography variant="overline">{me.business.name}</Typography>
          <Typography variant="h1">Agenda de hoy</Typography>
          <Typography color="text.secondary">
            Priorizá confirmaciones, detectá turnos con riesgo y mantené la ocupación del día bajo
            control.
          </Typography>
        </Box>

        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            component={Link}
            href="/demo"
            variant="outlined"
            size="small"
            startIcon={<VisibilityRoundedIcon />}
          >
            Ver demo
          </Button>
          <Button
            component={Link}
            href="/customers"
            variant="contained"
            size="small"
            startIcon={<GroupsRoundedIcon />}
          >
            Clientes
          </Button>
        </Stack>
      </Stack>

      <section className={styles.metrics} aria-label="Indicadores del día">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent className={styles.metricCard}>
              <span className={styles.metricIcon}>{metric.icon}</span>
              <Typography variant="body2" color="text.secondary">
                {metric.label}
              </Typography>
              <Typography variant="h4">{metric.value}</Typography>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className={styles.workspace}>
        <Card id="agenda" className={styles.agendaCard}>
          <CardContent className={styles.agendaContent}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
              <Box>
                <Typography variant="h2">Turnos de hoy</Typography>
                <Typography variant="body2" color="text.secondary">
                  Turnos que conviene gestionar primero.
                </Typography>
              </Box>
              <Typography className={styles.dateMeta} sx={{ textTransform: 'capitalize' }}>
                {today}
              </Typography>
            </Stack>
            <EmptyState
              icon={<EventBusyRoundedIcon />}
              title="Todavía no hay turnos"
              description="Los turnos del día aparecen acá cuando esté habilitada la reserva de turnos."
              action={
                <Button component={Link} href="/demo" size="small">
                  Ver cómo se va a ver
                </Button>
              }
            />
          </CardContent>
        </Card>

        <Stack sx={{ gap: 2 }}>
          <Card id="riesgo">
            <CardContent>
              <Stack direction="row" sx={{ gap: 1, alignItems: 'center', mb: 1 }}>
                <span className={styles.aiIcon}>
                  <AutoAwesomeRoundedIcon fontSize="small" />
                </span>
                <Typography variant="h2">Recomendación IA</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Cuando haya turnos con score de riesgo, desde cada turno vas a poder pedir una
                explicación y recomendaciones a la IA.
              </Typography>
            </CardContent>
          </Card>

          <Card id="reportes">
            <CardContent>
              <Stack direction="row" sx={{ gap: 1, alignItems: 'center', mb: 1 }}>
                <span className={styles.aiIcon}>
                  <QueryStatsRoundedIcon fontSize="small" />
                </span>
                <Typography variant="h2">Salud de la agenda</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Asistencia, huecos y ausencias se calculan a partir de los turnos registrados.
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      </section>
    </>
  );
}
