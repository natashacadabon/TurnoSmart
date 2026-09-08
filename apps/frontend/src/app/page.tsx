'use client';

import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import QueryStatsRoundedIcon from '@mui/icons-material/QueryStatsRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import styles from './page.module.css';

const appointments = [
  {
    time: '09:00',
    customer: 'Ana Perez',
    service: 'Corte y peinado',
    status: 'Confirmado',
    riskLabel: 'Bajo riesgo',
    riskTone: 'success' as const,
    statusTone: 'success' as const,
    statusIcon: <CheckCircleRoundedIcon className={styles.chipIcon} />,
  },
  {
    time: '10:30',
    customer: 'Julia Gomez',
    service: 'Coloración',
    status: 'Pendiente',
    riskLabel: 'Riesgo medio',
    riskTone: 'warning' as const,
    statusTone: 'warning' as const,
    statusIcon: <ScheduleRoundedIcon className={styles.chipIcon} />,
  },
  {
    time: '15:00',
    customer: 'Maria Lopez',
    service: 'Consulta profesional',
    status: 'Sin confirmar',
    riskLabel: 'Riesgo alto',
    riskTone: 'error' as const,
    statusTone: 'error' as const,
    statusIcon: <WarningAmberRoundedIcon className={styles.chipIcon} />,
  },
];

const metrics = [
  { label: 'Turnos hoy', value: '18', icon: <CalendarMonthRoundedIcon /> },
  { label: 'Ocupación', value: '87%', icon: <QueryStatsRoundedIcon /> },
  { label: 'Riesgo alto', value: '3', icon: <WarningAmberRoundedIcon /> },
  { label: 'Emails enviados', value: '12', icon: <MailOutlineRoundedIcon /> },
];

export default function Home() {
  const [noticeState, setNoticeState] = useState<'visible' | 'closing' | 'closed'>('visible');

  const closeActionNotice = () => {
    setNoticeState('closing');
    window.setTimeout(() => setNoticeState('closed'), 180);
  };

  return (
    <main className={styles.shell}>
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
          <a className={styles.navActive} href="#agenda">
            <CalendarMonthRoundedIcon fontSize="small" />
            Agenda
          </a>
          <a href="#clientes">
            <GroupsRoundedIcon fontSize="small" />
            Clientes
          </a>
          <a href="#riesgo">
            <AutoAwesomeRoundedIcon fontSize="small" />
            Predicciones IA
          </a>
          <a href="#reportes">
            <QueryStatsRoundedIcon fontSize="small" />
            Reportes
          </a>
        </nav>
      </aside>

      <section className={styles.content}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          sx={{ justifyContent: 'space-between', gap: 2.5, alignItems: { md: 'flex-start' } }}
        >
          <Box className={styles.heading}>
            <Typography variant="overline">Estudio Aurora</Typography>
            <Typography variant="h1">Agenda de hoy</Typography>
            <Typography color="text.secondary">
              Priorizá confirmaciones, detectá turnos con riesgo y mantené la ocupación del día bajo
              control.
            </Typography>
          </Box>

          <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="outlined" size="small" startIcon={<ScheduleRoundedIcon />}>
              Nuevo turno
            </Button>
            <Button variant="contained" size="small" startIcon={<MailOutlineRoundedIcon />}>
              Recordatorios
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
                  <Typography variant="h2">Requieren atención</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Turnos que conviene gestionar primero.
                  </Typography>
                </Box>
                <Typography className={styles.dateMeta}>Martes 8 Sep</Typography>
              </Stack>

              <Stack
                className={styles.appointmentList}
                divider={<Divider flexItem className={styles.rowDivider} />}
                spacing={0}
              >
                {appointments.map((appointment) => (
                  <article className={styles.appointment} key={appointment.time}>
                    <div className={styles.time}>
                      <strong>{appointment.time}</strong>
                    </div>
                    <div className={styles.appointmentMain}>
                      <Typography className={styles.customerName}>
                        {appointment.customer}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {appointment.service}
                      </Typography>
                    </div>
                    <div className={styles.rowControls}>
                      <Stack
                        direction="row"
                        sx={{ gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}
                      >
                        <Chip
                          className={styles.statusChip}
                          icon={appointment.statusIcon}
                          label={appointment.status}
                          color={appointment.statusTone}
                          variant="outlined"
                        />
                        <Chip
                          className={styles.riskChip}
                          label={appointment.riskLabel}
                          color={appointment.riskTone}
                          variant="outlined"
                        />
                      </Stack>
                      {appointment.status !== 'Confirmado' && (
                        <Button size="small" variant="contained">
                          Confirmar
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </Stack>
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
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Maria Lopez tiene riesgo alto por ser primera visita y tener el turno en horario
                  crítico.
                </Typography>
                <Button fullWidth variant="contained" color="secondary" size="small">
                  Enviar recordatorio reforzado
                </Button>
              </CardContent>
            </Card>

            <Card id="reportes">
              <CardContent>
                <Typography variant="h2">Salud de la agenda</Typography>
                <Stack sx={{ gap: 1.25, mt: 2 }}>
                  <HealthRow label="Asistencia esperada" value="91%" tone="success" />
                  <HealthRow label="Huecos probables" value="24%" tone="warning" />
                  <HealthRow label="No-shows estimados" value="12%" tone="error" />
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </section>
      </section>

      {noticeState !== 'closed' && (
        <aside
          id="clientes"
          className={`${styles.actionNotice} ${
            noticeState === 'visible' ? styles.noticeVisible : ''
          }`}
        >
          <div className={styles.noticeHeader}>
            <span className={styles.noticeIcon} aria-hidden="true">
              <CheckCircleRoundedIcon fontSize="small" />
            </span>
            <Typography variant="h2">Próxima acción</Typography>
            <IconButton
              aria-label="Cerrar aviso"
              className={styles.noticeClose}
              size="small"
              onClick={closeActionNotice}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </div>
          <Typography variant="body2" color="text.secondary">
            Confirmar 3 turnos antes de las 12:00 para sostener la ocupación del día.
          </Typography>
        </aside>
      )}
    </main>
  );
}

function HealthRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'error';
}) {
  return (
    <div className={styles.healthRow}>
      <Typography variant="body2">{label}</Typography>
      <span className={`${styles.healthValue} ${styles[tone]}`}>{value}</span>
    </div>
  );
}
