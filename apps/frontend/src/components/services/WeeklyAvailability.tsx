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
  Tab,
  Tabs,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  replaceAvailabilityRulesSchema,
  type AvailabilityRuleInput,
  type AvailabilityRulesResponse,
} from '@turnosmart/shared';
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
}: {
  canWrite: boolean;
  onSaved: () => void;
}) {
  const { setDirty } = useUnsavedChanges();
  const [saved, setSaved] = useState<Week>();
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const pending = useRef<Promise<AvailabilityRulesResponse> | null>(null);
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
    : Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join('.'),
          issue.message.replace('startTime', 'la hora de inicio'),
        ]),
      );
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

  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);

  useEffect(() => {
    if (!dirty) return;
    function confirmLeave(event: BeforeUnloadEvent) {
      event.preventDefault();
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

  async function save(event: FormEvent) {
    event.preventDefault();
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

  return (
    <Card component="section" aria-labelledby="weekly-title" sx={{ minWidth: 0 }}>
      <CardContent>
        <Stack component="form" spacing={2.5} onSubmit={save} noValidate sx={{ minWidth: 0 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' } }}
          >
            <Stack spacing={0.5}>
              <Typography variant="h2" id="weekly-title">
                Disponibilidad semanal
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Configurá los horarios de atención de tu negocio.
              </Typography>
              {saved && (
                <Chip
                  label={`Zona horaria · ${saved.timezone}`}
                  size="small"
                  variant="outlined"
                  sx={{
                    alignSelf: 'flex-start',
                    maxWidth: '100%',
                    height: 'auto',
                    color: '#7C3AED',
                    borderColor: 'divider',
                    '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 },
                  }}
                />
              )}
            </Stack>
            {canWrite && saved && (
              <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                {dirty && (
                  <Button size="small" disabled={saving} onClick={() => edit(saved.rules)}>
                    Descartar cambios
                  </Button>
                )}
                <Button type="submit" variant="contained" disabled={!canSave}>
                  {saving ? 'Guardando…' : 'Guardar cambios'}
                </Button>
              </Stack>
            )}
          </Stack>
          {loadError ? (
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
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
              {!canWrite && (
                <Typography variant="body2">Podés consultar las franjas con tu rol.</Typography>
              )}
              {dirty && (
                <Typography
                  variant="body2"
                  role="status"
                  sx={{ color: 'warning.main', fontWeight: 600 }}
                >
                  Hay cambios de disponibilidad sin guardar.
                </Typography>
              )}
              {dirty && !parsed.success && (
                <Alert severity="warning">Revisá las franjas indicadas antes de guardar.</Alert>
              )}
              {message && <Alert severity="error">{message}</Alert>}
              {success && <Alert severity="success">Disponibilidad guardada.</Alert>}
              <Tabs
                value={selectedDay}
                onChange={(_, value: number) => setSelectedDay(value)}
                aria-label="Disponibilidad por día"
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={{ minWidth: 0, borderBottom: 1, borderColor: 'divider' }}
              >
                {week.map(({ number, label, short, status }) => {
                  return (
                    <Tab
                      key={number}
                      id={`weekly-tab-${number}`}
                      aria-controls="weekly-day-panel"
                      aria-label={`${label}, ${status}`}
                      value={number}
                      label={
                        <>
                          <span>{short}</span>
                          <Typography component="span" variant="caption">
                            {status}
                          </Typography>
                        </>
                      }
                      sx={{
                        minWidth: 82,
                        minHeight: 56,
                        px: 1.25,
                        textTransform: 'none',
                        '&.Mui-selected': {
                          bgcolor: 'action.selected',
                          color: 'primary.dark',
                          fontWeight: 700,
                        },
                        '&:focus-visible': {
                          outline: '2px solid',
                          outlineColor: 'primary.dark',
                          outlineOffset: -2,
                        },
                      }}
                    />
                  );
                })}
              </Tabs>

              <Stack
                spacing={1.5}
                role="tabpanel"
                id="weekly-day-panel"
                aria-labelledby={`weekly-tab-${selectedDay}`}
              >
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

              <Box
                component="section"
                aria-labelledby="weekly-summary"
                sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}
              >
                <Typography component="h3" id="weekly-summary" sx={{ fontWeight: 700, mb: 1 }}>
                  Resumen semanal
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: 'repeat(2, minmax(0, 1fr))',
                      sm: 'repeat(4, minmax(0, 1fr))',
                      lg: 'repeat(7, minmax(0, 1fr))',
                    },
                    gap: 0.75,
                  }}
                >
                  {week.map(({ number, label, short, entries, status }) => {
                    return (
                      <Button
                        key={number}
                        aria-label={`${canWrite ? 'Editar' : 'Ver'} disponibilidad del ${label.toLowerCase()}`}
                        aria-pressed={selectedDay === number}
                        onClick={() => {
                          setSelectedDay(number);
                          document.getElementById(`weekly-tab-${number}`)?.focus();
                        }}
                        sx={{
                          minWidth: 0,
                          py: 0.75,
                          px: 1,
                          justifyContent: 'flex-start',
                          textAlign: 'left',
                          '&:focus-visible': {
                            outline: '2px solid',
                            outlineColor: 'primary.dark',
                            outlineOffset: -2,
                          },
                          alignItems: 'flex-start',
                          color: 'text.primary',
                          bgcolor:
                            selectedDay === number ? 'action.selected' : 'background.default',
                        }}
                      >
                        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {short}
                          </Typography>
                          <Typography variant="caption" color="text.primary">
                            {status}
                          </Typography>
                          {entries
                            .filter(({ rule }) => rule.startTime && rule.endTime)
                            .map(({ rule }) => (
                              <Typography key={rule.id} variant="caption">
                                {rule.startTime}–{rule.endTime}
                                {!rule.active && ' · Inactiva'}
                              </Typography>
                            ))}
                        </Stack>
                      </Button>
                    );
                  })}
                </Box>
              </Box>
            </>
          )}
        </Stack>
      </CardContent>
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
    </Card>
  );
}
