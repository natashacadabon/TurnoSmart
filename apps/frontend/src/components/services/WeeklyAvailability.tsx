'use client';

import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormGroup,
  IconButton,
  FormControlLabel,
  Stack,
  Tooltip,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  replaceAvailabilityRulesSchema,
  type AvailabilityRuleInput,
  type AvailabilityRulesResponse,
} from '@turnosmart/shared';
import { Eye, Pencil } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useUnsavedChanges } from '../UnsavedChangesProvider';
import { api, errorMessage, fieldErrors } from '../../lib/api';

const PATH = '/api/availability-rules';
const DAYS = [
  { number: 1, label: 'Lunes', short: 'Lun' },
  { number: 2, label: 'Martes', short: 'Mar' },
  { number: 3, label: 'Miércoles', short: 'Mié' },
  { number: 4, label: 'Jueves', short: 'Jue' },
  { number: 5, label: 'Viernes', short: 'Vie' },
  { number: 6, label: 'Sábado', short: 'Sáb' },
  { number: 0, label: 'Domingo', short: 'Dom' },
];

type DraftRule = AvailabilityRuleInput & { id: string };
type Week = { timezone: string; rules: DraftRule[] };

function toWeek({ data }: AvailabilityRulesResponse): Week {
  return {
    timezone: data.timezone,
    rules: data.rules.map(({ id, dayOfWeek, startTime, endTime, active }) => ({
      id,
      dayOfWeek,
      startTime,
      endTime,
      active,
    })),
  };
}

function payload(rules: DraftRule[]) {
  return rules.map(({ dayOfWeek, startTime, endTime, active }) => ({
    dayOfWeek,
    startTime,
    endTime,
    active,
  }));
}

function signature(rules: DraftRule[]) {
  return payload(rules)
    .map((rule) => JSON.stringify(rule))
    .sort()
    .join('\n');
}

function minutes(time: string) {
  const [hours, remainder] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (remainder ?? 0);
}

export function WeeklyAvailability({
  canWrite,
  onSaved,
  onSummary,
}: {
  canWrite: boolean;
  onSaved: () => void;
  onSummary?: (minutes: number | null) => void;
}) {
  const { setDirty } = useUnsavedChanges();
  const [saved, setSaved] = useState<Week>();
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const pending = useRef<Promise<AvailabilityRulesResponse> | null>(null);
  const [editing, setEditing] = useState(false);
  const [selectedDay, setSelectedDay] = useState(1);
  const [copyTargets, setCopyTargets] = useState<number[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const dirty = saved !== undefined && signature(rules) !== signature(saved.rules);
  const parsed = replaceAvailabilityRulesSchema.safeParse({ rules: payload(rules) });
  const validation = parsed.success
    ? {}
    : Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
  const fieldIssues = { ...errors, ...validation };
  const week = DAYS.map((item) => {
    const entries = rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => rule.dayOfWeek === item.number);
    const active = entries.some(({ rule }) => rule.active);
    const invalid = entries.some(
      ({ index }) =>
        fieldIssues[`rules.${index}.startTime`] || fieldIssues[`rules.${index}.endTime`],
    );
    return {
      ...item,
      entries,
      active,
      invalid,
      status: invalid ? 'Revisar' : active ? 'Disponible' : 'Sin atención',
    };
  });
  const day = week.find(({ number }) => number === selectedDay)!;
  const { entries: dayRules, active: open, invalid: dayHasErrors } = day;
  const total = dayHasErrors
    ? 0
    : dayRules.reduce(
        (sum, { rule }) =>
          rule.active ? sum + minutes(rule.endTime) - minutes(rule.startTime) : sum,
        0,
      );
  const canSave =
    canWrite && dirty && !saving && parsed.success && Object.keys(errors).length === 0;
  const copyKeeps = copyTargets
    ? rules.filter((rule) => !copyTargets.includes(rule.dayOfWeek))
    : [];
  const copyReplaces = copyTargets !== null && copyKeeps.length !== rules.length;
  const copyFits =
    copyTargets !== null && copyKeeps.length + dayRules.length * copyTargets.length <= 100;

  useEffect(() => {
    let current = true;
    const read = (pending.current ??= api<AvailabilityRulesResponse>(PATH));
    void read.then(
      (response) => {
        if (pending.current === read) pending.current = null;
        if (!current) return;
        const week = toWeek(response);
        setSaved(week);
        setRules(week.rules);
      },
      (error: unknown) => {
        if (pending.current === read) pending.current = null;
        if (current) setLoadError(errorMessage(error));
      },
    );
    return () => {
      current = false;
    };
  }, [reload]);

  const weeklyMinutes =
    saved && replaceAvailabilityRulesSchema.safeParse({ rules: payload(saved.rules) }).success
      ? saved.rules.reduce(
          (sum, rule) =>
            rule.active ? sum + minutes(rule.endTime) - minutes(rule.startTime) : sum,
          0,
        )
      : null;
  useEffect(() => {
    onSummary?.(weeklyMinutes);
  }, [onSummary, weeklyMinutes]);

  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  useEffect(() => {
    if (!dirty) return;
    function confirmLeave(event: BeforeUnloadEvent) {
      event?.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener('beforeunload', confirmLeave);
    return () => window.removeEventListener('beforeunload', confirmLeave);
  }, [dirty]);
  function edit(next: DraftRule[]) {
    setRules(next);
    setErrors({});
    setMessage('');
    setSuccess(false);
  }

  function patch(id: string, change: Partial<AvailabilityRuleInput>) {
    edit(rules.map((rule) => (rule.id === id ? { ...rule, ...change } : rule)));
  }

  function add(dayOfWeek: number) {
    edit([
      ...rules,
      { id: crypto.randomUUID(), dayOfWeek, startTime: '', endTime: '', active: true },
    ]);
  }

  function setDay(dayOfWeek: number, active: boolean) {
    if (active && !rules.some((rule) => rule.dayOfWeek === dayOfWeek)) {
      add(dayOfWeek);
      return;
    }
    const next = active
      ? rules
      : rules.filter((rule) => rule.dayOfWeek !== dayOfWeek || rule.startTime || rule.endTime);
    edit(next.map((rule) => (rule.dayOfWeek === dayOfWeek ? { ...rule, active } : rule)));
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!canSave || !parsed.success) return;

    setSaving(true);
    setErrors({});
    setMessage('');
    try {
      const week = toWeek(
        await api<AvailabilityRulesResponse>(PATH, { method: 'PUT', body: parsed.data }),
      );
      setSaved(week);
      setRules(week.rules);
      setSuccess(true);
      onSaved();
    } catch (error) {
      setErrors(fieldErrors(error));
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function applyCopy() {
    if (!copyTargets?.length || !copyFits) return;
    edit([
      ...copyKeeps,
      ...copyTargets.flatMap((dayOfWeek) =>
        dayRules.map(({ rule }) => ({ ...rule, dayOfWeek, id: crypto.randomUUID() })),
      ),
    ]);
    setCopyTargets(null);
  }

  const activeRules = rules.filter(
    (rule) =>
      rule.active &&
      /^\d{2}:\d{2}$/.test(rule.startTime) &&
      /^\d{2}:\d{2}$/.test(rule.endTime) &&
      minutes(rule.endTime) > minutes(rule.startTime),
  );
  const axisStart = Math.max(
    0,
    Math.floor(Math.min(8 * 60, ...activeRules.map((rule) => minutes(rule.startTime))) / 60) * 60,
  );
  const axisEnd = Math.min(
    1440,
    Math.ceil(Math.max(18 * 60, ...activeRules.map((rule) => minutes(rule.endTime))) / 60) * 60,
  );
  const axisLength = axisEnd - axisStart;
  const timeLabel = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const feedback = (
    <>
      {dirty && (
        <Typography variant="caption" role="status" color="warning.main">
          Hay cambios de disponibilidad sin guardar.
        </Typography>
      )}
      {!parsed.success && (
        <Alert severity="warning">
          {fieldIssues.rules ??
            (dirty
              ? 'Revisá las franjas indicadas antes de guardar.'
              : 'La disponibilidad guardada tiene errores. Revisá los días marcados como «Revisar».')}
        </Alert>
      )}
      {message && <Alert severity="error">{message}</Alert>}
      {success && <Alert severity="success">Disponibilidad guardada.</Alert>}
    </>
  );
  return (
    <>
      <Card component="section" aria-labelledby="weekly-title" sx={{ minWidth: 0 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography component="h2" variant="h2" id="weekly-title" sx={{ fontSize: 17 }}>
                Disponibilidad semanal
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ overflowWrap: 'anywhere' }}
              >
                Horarios de atención · {saved?.timezone ?? 'Cargando…'}
              </Typography>
            </Box>
            {loadError ? (
              <Alert
                severity="error"
                action={
                  <Button
                    size="small"
                    onClick={() => {
                      setLoadError('');
                      setReload((value) => value + 1);
                    }}
                  >
                    Reintentar
                  </Button>
                }
              >
                {loadError}
              </Alert>
            ) : !saved ? (
              <CircularProgress size={24} aria-label="Cargando disponibilidad semanal" />
            ) : (
              <>
                {!editing && feedback}
                <Box role="group" aria-label="Semana de atención">
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '72px minmax(0, 1fr) 20px',
                      mb: 0.5,
                    }}
                  >
                    <Box />
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }} aria-hidden>
                      {[0, 0.5, 1].map((fraction) => (
                        <Typography key={fraction} sx={{ fontSize: 10 }} color="text.secondary">
                          {timeLabel(axisStart + Math.round(axisLength * fraction))}
                        </Typography>
                      ))}
                    </Stack>
                  </Box>
                  {week.map(({ number, label, entries, invalid, active }) => {
                    const ranges = entries.filter(
                      ({ rule }) => rule.active && rule.startTime && rule.endTime,
                    );
                    return (
                      <Tooltip
                        key={number}
                        describeChild
                        title={
                          invalid
                            ? 'Revisar horarios'
                            : active
                              ? ranges
                                  .map(({ rule }) => `${rule.startTime}–${rule.endTime}`)
                                  .join(' · ')
                              : 'Cerrado'
                        }
                      >
                        <Button
                          fullWidth
                          aria-label={`${canWrite ? 'Editar' : 'Ver'} disponibilidad del ${label.toLowerCase()}`}
                          onClick={() => {
                            setSelectedDay(number);
                            setEditing(true);
                          }}
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: '64px minmax(0, 1fr) 20px',
                            gap: 1,
                            px: 0,
                            py: 0.5,
                            minHeight: 36,
                            textAlign: 'left',
                            color: 'text.primary',
                            borderBottom: 1,
                            borderColor: 'divider',
                            borderRadius: 0,
                            '&:last-child': { borderBottom: 0 },
                          }}
                        >
                          <Typography component="span" sx={{ fontSize: 12, fontWeight: 600 }}>
                            {label}
                          </Typography>
                          <Box
                            component="span"
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: `repeat(${axisLength}, minmax(0, 1fr))`,
                              alignItems: 'center',
                              minHeight: 26,
                              borderRadius: 1,
                              bgcolor: 'action.hover',
                            }}
                          >
                            {!active && !invalid && (
                              <Typography
                                component="span"
                                sx={{ gridColumn: '1 / -1', px: 1, fontSize: 12 }}
                                color="text.secondary"
                              >
                                Cerrado
                              </Typography>
                            )}
                            {invalid ? (
                              <Typography
                                component="span"
                                sx={{ gridColumn: '1 / -1', px: 1, fontSize: 12 }}
                                color="error.main"
                              >
                                Revisar horarios
                              </Typography>
                            ) : (
                              ranges.map(({ rule }) => (
                                <Box
                                  key={rule.id}
                                  component="span"
                                  sx={{
                                    gridRow: 1,
                                    gridColumn: `${Math.max(1, minutes(rule.startTime) - axisStart + 1)} / ${Math.min(axisLength + 1, minutes(rule.endTime) - axisStart + 1)}`,
                                    bgcolor: 'primary.main',
                                    color: 'primary.contrastText',
                                    px: 0.5,
                                    py: 0.5,
                                    borderRadius: 0.5,
                                    fontSize: { xs: 12, sm: 11 },
                                    lineHeight: 1.3,
                                    display: 'flex',
                                    flexDirection: { xs: 'column', sm: 'row' },
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    textAlign: 'center',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  <Box component="span">{rule.startTime}</Box>
                                  <Box
                                    component="span"
                                    sx={{ display: { xs: 'none', sm: 'inline' } }}
                                  >
                                    –
                                  </Box>
                                  <Box component="span">{rule.endTime}</Box>
                                </Box>
                              ))
                            )}
                          </Box>
                          {canWrite ? (
                            <Pencil size={14} aria-hidden />
                          ) : (
                            <Eye size={14} aria-hidden />
                          )}
                        </Button>
                      </Tooltip>
                    );
                  })}
                </Box>
                {canWrite && dirty && !editing && (
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" disabled={saving} onClick={() => edit(saved.rules)}>
                      Descartar cambios
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={!canSave}
                      onClick={() => void save()}
                    >
                      {saving ? 'Guardando…' : 'Guardar cambios'}
                    </Button>
                  </Stack>
                )}
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
      <Dialog
        open={editing}
        onClose={saving ? undefined : () => setEditing(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="weekly-editor-title"
      >
        <Box component="form" onSubmit={save} noValidate>
          <DialogTitle id="weekly-editor-title" sx={{ fontSize: 18 }}>
            Horarios del {day.label.toLowerCase()}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              {feedback}
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                >
                  <Stack spacing={0.25}>
                    <Typography component="h3" sx={{ fontWeight: 700 }}>
                      {day.label}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {dayHasErrors
                        ? 'Corregí las franjas para calcular el total.'
                        : `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min de atención`}
                    </Typography>
                  </Stack>
                  {canWrite && (
                    <FormControlLabel
                      sx={{ m: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}
                      control={
                        <Switch
                          checked={open}
                          slotProps={{ input: { role: 'switch' } }}
                          disabled={saving || (!dayRules.length && rules.length >= 100)}
                          onChange={(_, checked) => setDay(selectedDay, checked)}
                        />
                      }
                      label={`Atender el ${day.label.toLowerCase()}`}
                    />
                  )}
                </Stack>
                {!dayRules.length && (
                  <Typography variant="body2" color="text.secondary">
                    Sin franjas configuradas.
                  </Typography>
                )}
                {dayRules.map(({ rule, index }, position) =>
                  canWrite ? (
                    <Stack
                      key={rule.id}
                      direction="row"
                      spacing={1}
                      sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}
                      useFlexGap
                    >
                      {(['startTime', 'endTime'] as const).map((field) => {
                        const key = `rules.${index}.${field}`;
                        const error = fieldIssues[key];
                        return (
                          <TextField
                            key={field}
                            label={`${field === 'startTime' ? 'Inicio' : 'Fin'} ${day.label.toLowerCase()} ${position + 1}`}
                            type="time"
                            size="small"
                            value={rule[field]}
                            disabled={saving}
                            onChange={(event) => patch(rule.id, { [field]: event.target.value })}
                            error={Boolean(error)}
                            helperText={error}
                            slotProps={{ inputLabel: { shrink: true } }}
                            sx={{ flex: '1 1 118px', maxWidth: { sm: 230 }, minWidth: 0 }}
                          />
                        );
                      })}
                      {!rule.active && <Chip size="small" label="Inactiva" sx={{ mt: 1 }} />}
                      <IconButton
                        color="error"
                        disabled={saving}
                        aria-label={`Eliminar franja ${position + 1} del ${day.label.toLowerCase()}`}
                        onClick={() => edit(rules.filter((item) => item.id !== rule.id))}
                        sx={{ width: 40, height: 40, flexShrink: 0 }}
                      >
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ) : (
                    <Typography key={rule.id} variant="body2">
                      {rule.startTime}–{rule.endTime}
                      {!rule.active && ' · Inactiva'}
                    </Typography>
                  ),
                )}
                {canWrite && (
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <Button
                      disabled={saving || rules.length >= 100}
                      onClick={() => add(selectedDay)}
                    >
                      Agregar franja
                    </Button>
                    <Button
                      disabled={saving || !open || dayHasErrors}
                      onClick={() => setCopyTargets([])}
                    >
                      Copiar horario a otros días
                    </Button>
                  </Stack>
                )}
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 2, pb: 2, flexWrap: 'wrap' }}>
            <Button disabled={saving} onClick={() => setEditing(false)}>
              Cerrar
            </Button>
            {canWrite && (
              <>
                <Button disabled={!dirty || saving} onClick={() => saved && edit(saved.rules)}>
                  Descartar cambios
                </Button>
                <Button type="submit" variant="contained" disabled={!canSave}>
                  {saving ? 'Guardando…' : 'Guardar cambios'}
                </Button>
              </>
            )}
          </DialogActions>
        </Box>
      </Dialog>
      {copyTargets && (
        <Dialog
          open
          onClose={() => setCopyTargets(null)}
          aria-labelledby="weekly-copy-title"
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle id="weekly-copy-title">Copiar horario a otros días</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              Elegí los días que recibirán las franjas del {day.label.toLowerCase()}.
            </Typography>
            <FormGroup>
              {DAYS.filter(({ number }) => number !== selectedDay).map(({ number, label }) => (
                <FormControlLabel
                  key={number}
                  label={label}
                  control={
                    <Checkbox
                      checked={copyTargets.includes(number)}
                      onChange={(_, checked) =>
                        setCopyTargets(
                          checked
                            ? [...copyTargets, number]
                            : copyTargets.filter((target) => target !== number),
                        )
                      }
                    />
                  }
                />
              ))}
            </FormGroup>
            {copyReplaces && (
              <Alert severity="warning">
                Se reemplazarán las franjas existentes de los días seleccionados.
              </Alert>
            )}
            {!copyFits && (
              <Alert severity="error">La semana no puede superar las 100 franjas.</Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCopyTargets(null)}>Cancelar</Button>
            <Button
              variant="contained"
              disabled={!copyTargets.length || !copyFits}
              onClick={applyCopy}
            >
              Copiar horario
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
