'use client';

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import type { AppointmentDto, RiskExplanationResponse, RiskLevel } from '@turnosmart/shared';
import { Activity, ArrowUpRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RiskExplanationPanel } from '@/components/RiskExplanationPanel';
import { appointmentStates } from '@/lib/agenda';
import { slotTimeFormatter } from '@/lib/calendar-events';

const outcomes = [
  { status: 'COMPLETED', label: 'Completados' },
  { status: 'CANCELLED', label: 'Cancelados' },
  { status: 'NO_SHOW', label: 'Ausentes' },
] as const;

const riskLabels: Record<
  RiskLevel,
  { label: string; color: 'error' | 'warning' | 'success'; rank: number }
> = {
  HIGH: { label: 'Riesgo alto', color: 'error', rank: 3 },
  MEDIUM: { label: 'Riesgo medio', color: 'warning', rank: 2 },
  LOW: { label: 'Riesgo bajo', color: 'success', rank: 1 },
};

function analysisKey(appointment: AppointmentDto) {
  return `${appointment.id}/${appointment.startsAt}/${appointment.endsAt}`;
}

function AgendaHealth({ appointments }: { appointments: AppointmentDto[] | null }) {
  const counts = { COMPLETED: 0, CANCELLED: 0, NO_SHOW: 0 };
  for (const appointment of appointments ?? []) {
    const status = appointment.status;
    if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'NO_SHOW') counts[status]++;
  }
  const represented = outcomes.filter(({ status }) => counts[status] > 0);

  return (
    <Card id="reportes" component="section" aria-labelledby="agenda-health-heading">
      <CardContent sx={{ p: 1.75, '&:last-child': { pb: 1.75 } }}>
        <Stack spacing={1.25}>
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            useFlexGap
          >
            <Box sx={{ color: 'primary.main', display: 'flex' }}>
              <Activity size={17} aria-hidden />
            </Box>
            <Typography
              id="agenda-health-heading"
              variant="h2"
              sx={{ fontSize: '1rem', flexGrow: 1 }}
            >
              Salud de la agenda
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Hoy
            </Typography>
          </Stack>
          <Box
            component="dl"
            sx={{
              m: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 0.5,
            }}
          >
            {outcomes.map(({ status, label }) => {
              const { icon: Icon, background, color } = appointmentStates[status];
              return (
                <Box
                  key={status}
                  sx={{
                    p: 0.75,
                    borderRadius: 1,
                    bgcolor: background,
                    color,
                    textAlign: 'center',
                    overflowWrap: 'anywhere',
                  }}
                >
                  <Stack
                    component="dt"
                    spacing={0.25}
                    sx={{ alignItems: 'center', fontSize: '0.7rem', lineHeight: 1.25 }}
                  >
                    <Icon size={15} aria-hidden />
                    <span>{label}</span>
                  </Stack>
                  <Typography
                    component="dd"
                    sx={{ m: 0, mt: 0.25, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {appointments === null ? '—' : counts[status]}
                  </Typography>
                </Box>
              );
            })}
          </Box>
          {appointments === null ? (
            <Typography variant="caption" color="text.secondary">
              Datos aún no disponibles.
            </Typography>
          ) : represented.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              Sin turnos cerrados hoy.
            </Typography>
          ) : represented.length > 1 ? (
            <Box
              role="img"
              aria-label={
                'Distribución de turnos cerrados: ' +
                represented
                  .map(({ status, label }) => `${counts[status]} ${label.toLowerCase()}`)
                  .join(', ')
              }
              sx={{ display: 'flex', height: 6, borderRadius: 1, gap: '2px', overflow: 'hidden' }}
            >
              {represented.map(({ status }) => (
                <Box
                  key={status}
                  sx={{ flex: `${counts[status]} 1 0`, bgcolor: appointmentStates[status].color }}
                />
              ))}
            </Box>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

interface Props {
  appointments: AppointmentDto[] | null;
  now: number;
  timezone: string;
  expanded: boolean;
  canExplain: boolean;
  onRiskDialogChange(open: boolean): void;
  onHighRiskCountChange(count: number | null): void;
}

export function AgendaInsights({
  appointments,
  now,
  timezone,
  expanded,
  canExplain,
  onRiskDialogChange,
  onHighRiskCountChange,
}: Props) {
  const [selected, setSelected] = useState<AppointmentDto | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, RiskExplanationResponse>>({});
  const eligible = (appointments ?? [])
    .filter(({ status }) => status === 'SCHEDULED' || status === 'CONFIRMED')
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const analyzed = eligible.flatMap((appointment) => {
    const result = analyses[analysisKey(appointment)];
    return result ? [{ appointment, result }] : [];
  });
  const ranked = analyzed.sort(
    (a, b) =>
      riskLabels[b.result.risk.level].rank - riskLabels[a.result.risk.level].rank ||
      b.result.risk.score - a.result.risk.score,
  );
  const pending = eligible.filter((appointment) => !analyses[analysisKey(appointment)]);
  const candidate =
    pending.find((appointment) => Date.parse(appointment.startsAt) > now) ?? pending[0];
  const count =
    canExplain && appointments !== null && ranked.length === eligible.length
      ? ranked.filter(({ result }) => result.risk.level === 'HIGH').length
      : null;
  const time = slotTimeFormatter(timezone);

  useEffect(() => {
    onHighRiskCountChange(count);
  }, [count, onHighRiskCountChange]);

  function choose(appointment: AppointmentDto | null) {
    setSelected(appointment);
    onRiskDialogChange(appointment !== null);
  }

  return (
    <>
      <Stack
        component="aside"
        aria-label="Seguimiento de agenda"
        direction={{ xs: 'column', md: 'row', lg: 'column' }}
        spacing={1.5}
        useFlexGap
        sx={{
          minWidth: 0,
          display: { xs: 'flex', lg: expanded ? 'none' : 'flex' },
          '& > section': { minWidth: 0, flex: { md: '1 1 0', lg: 'initial' } },
        }}
      >
        <Card id="riesgo" component="section" aria-labelledby="agenda-risk-heading">
          <CardContent sx={{ p: 1.75, '&:last-child': { pb: 1.75 } }}>
            <Stack spacing={1}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Box sx={{ color: 'primary.main', display: 'flex' }}>
                  <Sparkles size={17} aria-hidden />
                </Box>
                <Typography id="agenda-risk-heading" variant="h2" sx={{ fontSize: '1rem' }}>
                  Recomendación IA
                </Typography>
              </Stack>
              {!canExplain ? (
                <Typography variant="body2" color="text.secondary">
                  Tu perfil no tiene acceso al análisis de riesgo.
                </Typography>
              ) : (
                <>
                  {appointments === null ? (
                    <Typography variant="body2" color="text.secondary">
                      Los turnos aún no están disponibles.
                    </Typography>
                  ) : ranked.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {candidate
                        ? 'Consultá el riesgo de un turno para ver recomendaciones.'
                        : 'Abrí el detalle de un turno para consultar su riesgo.'}
                    </Typography>
                  ) : (
                    <Stack component="ul" spacing={1.25} sx={{ m: 0, p: 0, listStyle: 'none' }}>
                      {ranked.slice(0, 3).map(({ appointment, result }) => {
                        const level = riskLabels[result.risk.level];
                        return (
                          <Stack
                            component="li"
                            key={appointment.id}
                            spacing={0.5}
                            sx={{ minWidth: 0 }}
                          >
                            <Stack
                              direction="row"
                              spacing={0.5}
                              useFlexGap
                              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                            >
                              <Typography
                                component={Link}
                                href={'/appointments/' + appointment.id}
                                variant="body2"
                                sx={{
                                  minWidth: 0,
                                  overflowWrap: 'anywhere',
                                  color: 'primary.main',
                                  fontWeight: 650,
                                }}
                              >
                                Turno · {time.format(new Date(appointment.startsAt))}
                              </Typography>
                              <Chip
                                size="small"
                                variant="outlined"
                                color={level.color}
                                label={level.label}
                              />
                            </Stack>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                display: '-webkit-box',
                                WebkitBoxOrient: 'vertical',
                                WebkitLineClamp: 2,
                                overflow: 'hidden',
                                overflowWrap: 'anywhere',
                              }}
                            >
                              {result.explanation.summary}
                            </Typography>
                            <Button
                              size="small"
                              onClick={() => choose(appointment)}
                              sx={{ alignSelf: 'flex-start', ml: -1 }}
                            >
                              Ver análisis
                            </Button>
                          </Stack>
                        );
                      })}
                    </Stack>
                  )}
                  {candidate && (
                    <Stack
                      direction="row"
                      spacing={0.5}
                      useFlexGap
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Button size="small" variant="outlined" onClick={() => choose(candidate)}>
                        Consultar IA
                      </Button>
                      <Button
                        component={Link}
                        href={'/appointments/' + candidate.id}
                        size="small"
                        endIcon={<ArrowUpRight size={14} />}
                      >
                        Ver turno · {time.format(new Date(candidate.startsAt))}
                      </Button>
                    </Stack>
                  )}
                </>
              )}
            </Stack>
          </CardContent>
        </Card>
        <AgendaHealth appointments={appointments} />
      </Stack>
      {canExplain && selected && (
        <Dialog
          open
          fullWidth
          maxWidth="sm"
          onClose={() => choose(null)}
          aria-labelledby="agenda-risk-title"
        >
          <DialogTitle id="agenda-risk-title">Recomendación IA</DialogTitle>
          <DialogContent>
            <RiskExplanationPanel
              key={analysisKey(selected)}
              appointmentId={selected.id}
              initialResult={analyses[analysisKey(selected)]}
              onExplained={(result) =>
                setAnalyses((previous) => ({ ...previous, [analysisKey(selected)]: result }))
              }
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => choose(null)}>Cerrar</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
