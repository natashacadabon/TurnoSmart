'use client';

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  FormGroup,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import {
  businessNotificationPreferencesSchema,
  emailPreviewKindSchema,
  REMINDER_HOUR_OPTIONS,
  type BusinessNotificationPreferences,
  type EmailPreviewDto,
} from '@turnosmart/shared';
import { CalendarDays, Mail, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '@/components/ToastProvider';
import { api, errorMessage } from '@/lib/api';

const path = '/api/business/notification-preferences';
const reminderOptions = REMINDER_HOUR_OPTIONS;
const previewLabels: Record<(typeof emailPreviewKindSchema.options)[number], string> = {
  BOOKED: 'Reserva',
  CONFIRMED: 'Confirmación de asistencia',
  REMINDER_24H: 'Recordatorio de 24 h',
  REMINDER_48H: 'Recordatorio de 48 h',
  CANCELLED: 'Cancelación',
  RESCHEDULED: 'Reprogramación',
  RESCHEDULE_DECLINED: 'Solicitud rechazada',
};
const emailSwitches = [
  ['bookingEmailEnabled', 'Email al reservar'],
  ['confirmationEmailEnabled', 'Email de confirmación'],
  ['cancellationEmailEnabled', 'Email de cancelación'],
  ['rescheduleEmailEnabled', 'Email de reprogramación'],
] as const;

export function NotificationSettings({ editable }: { editable: boolean }) {
  const { notify } = useToast();
  const [saved, setSaved] = useState<BusinessNotificationPreferences>();
  const [draft, setDraft] = useState<BusinessNotificationPreferences>();
  const [minimumHours, setMinimumHours] = useState<{
    cancellationMinimumHours?: string;
    rescheduleMinimumHours?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  useEffect(() => {
    let active = true;
    api<BusinessNotificationPreferences>(path).then(
      (value) => {
        if (active) setSaved(value);
      },
      (err) => {
        if (active) setError(errorMessage(err));
      },
    );
    return () => {
      active = false;
    };
  }, [revision]);

  const value = draft ?? saved;
  const cancellationHours =
    minimumHours.cancellationMinimumHours ?? String(value?.cancellationMinimumHours ?? '');
  const rescheduleHours =
    minimumHours.rescheduleMinimumHours ?? String(value?.rescheduleMinimumHours ?? '');
  const validHours = (input: string) => /^\d+$/.test(input) && Number(input) <= 720;
  const parsed = businessNotificationPreferencesSchema.safeParse({
    ...value,
    cancellationMinimumHours: Number(cancellationHours),
    rescheduleMinimumHours: Number(rescheduleHours),
  });
  const hoursValid = validHours(cancellationHours) && validHours(rescheduleHours);
  const remindersValid = !value?.remindersEnabled || value.reminderHours.length > 0;
  const dirty =
    !!value &&
    !!saved &&
    (JSON.stringify(value) !== JSON.stringify(saved) ||
      cancellationHours !== String(saved.cancellationMinimumHours) ||
      rescheduleHours !== String(saved.rescheduleMinimumHours));
  const disabled = !editable || saving;
  useEffect(() => {
    if (!dirty) return;
    const preventLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', preventLeave);
    return () => window.removeEventListener('beforeunload', preventLeave);
  }, [dirty]);

  function change<K extends keyof BusinessNotificationPreferences>(
    key: K,
    next: BusinessNotificationPreferences[K],
  ) {
    if (value) setDraft({ ...value, [key]: next });
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value || !saved || !dirty || !hoursValid || !remindersValid || !parsed.success || disabled)
      return;
    const body = Object.fromEntries(
      Object.entries(parsed.data).filter(
        ([key, item]) =>
          JSON.stringify(item) !==
          JSON.stringify(saved[key as keyof BusinessNotificationPreferences]),
      ),
    );
    setSaving(true);
    setError('');
    try {
      setSaved(await api<BusinessNotificationPreferences>(path, { method: 'PATCH', body }));
      setDraft(undefined);
      setMinimumHours({});
      notify('Preferencias de notificaciones guardadas');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Box component="section" aria-labelledby="notification-settings-title">
      <Box component="form" onSubmit={submit} noValidate aria-busy={saving}>
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              rowGap: 1,
            }}
          >
            <Typography id="notification-settings-title" component="h2" variant="h2">
              Notificaciones
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setShowPreview(true)}
              disabled={!value}
            >
              Vista previa de emails
            </Button>
          </Stack>
          {!value ? (
            error ? (
              <Alert
                severity="error"
                action={
                  <Button
                    onClick={() => {
                      setError('');
                      setRevision(revision + 1);
                    }}
                  >
                    Reintentar
                  </Button>
                }
              >
                {error}
              </Alert>
            ) : (
              <LinearProgress aria-label="Cargando preferencias de notificaciones" />
            )
          ) : (
            <>
              {!editable && (
                <Alert severity="info">
                  Solo dueños y administradores pueden modificar estas preferencias.
                </Alert>
              )}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
                  gap: 2,
                  '& .MuiCardContent-root': { p: 2, '&:last-child': { pb: 2 } },
                  '& .MuiFormControlLabel-root': { m: 0, gap: 0.5 },
                  '& .MuiFormControlLabel-label': { fontSize: 13 },
                  '& .MuiFormHelperText-root': { mx: 0 },
                  '& .MuiInputBase-root': { minHeight: 36, fontSize: 13 },
                }}
              >
                <Card component="section" aria-labelledby="email-settings-title">
                  <CardContent>
                    <Stack spacing={1.25}>
                      <Box>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                          <Box
                            component={Mail}
                            size={19}
                            sx={{ color: 'primary.main', flexShrink: 0 }}
                            aria-hidden
                          />
                          <Typography
                            id="email-settings-title"
                            component="h3"
                            sx={{ fontSize: 17, fontWeight: 600 }}
                          >
                            Notificaciones por correo
                          </Typography>
                        </Stack>
                        <Typography sx={{ fontSize: 12 }} color="text.secondary">
                          Avisos al email del cliente, en la zona horaria del negocio.
                        </Typography>
                      </Box>
                      <FormGroup
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                          gap: 0.5,
                        }}
                      >
                        {emailSwitches.map(([key, label]) => (
                          <FormControlLabel
                            key={key}
                            label={label}
                            control={
                              <Switch
                                size="small"
                                checked={value[key]}
                                disabled={disabled}
                                onChange={(_, next) => change(key, next)}
                              />
                            }
                          />
                        ))}
                      </FormGroup>
                      <Divider />
                      <Stack
                        direction="row"
                        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                      >
                        <Typography component="h4" sx={{ fontSize: 14, fontWeight: 600 }}>
                          Recordatorios automáticos
                        </Typography>
                        <Switch
                          size="small"
                          slotProps={{ input: { 'aria-label': 'Recordatorios automáticos' } }}
                          checked={value.remindersEnabled}
                          disabled={disabled}
                          onChange={(_, next) =>
                            setDraft({
                              ...value,
                              remindersEnabled: next,
                              reminderHours:
                                next && !value.reminderHours.length
                                  ? [48, 24]
                                  : value.reminderHours,
                            })
                          }
                        />
                      </Stack>
                      <Box
                        sx={{
                          p: 1,
                          bgcolor: 'action.hover',
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 2,
                        }}
                      >
                        <Stack spacing={1}>
                          <Typography sx={{ fontSize: 12 }} color="text.secondary">
                            {value.reminderHours.length} de 3 recordatorios configurados
                          </Typography>
                          {value.reminderHours.map((hours, index) => (
                            <Stack
                              key={index}
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'center' }}
                            >
                              <Typography
                                component="label"
                                htmlFor={`reminder-${index}`}
                                sx={{ flex: 1, minWidth: 95, fontSize: 12 }}
                              >
                                Recordatorio {index + 1}
                              </Typography>
                              <TextField
                                id={`reminder-${index}`}
                                select
                                size="small"
                                value={hours}
                                disabled={disabled || !value.remindersEnabled}
                                sx={{ width: { xs: 130, sm: 150 }, minWidth: 0 }}
                                slotProps={{
                                  select: {
                                    inputProps: { 'aria-label': `Recordatorio ${index + 1}` },
                                  },
                                }}
                                onChange={(event) =>
                                  change(
                                    'reminderHours',
                                    value.reminderHours.map((item, position) =>
                                      position === index ? Number(event.target.value) : item,
                                    ),
                                  )
                                }
                              >
                                {reminderOptions.map((option) => (
                                  <MenuItem
                                    key={option}
                                    value={option}
                                    disabled={
                                      option !== hours && value.reminderHours.includes(option)
                                    }
                                  >
                                    {option} h antes
                                  </MenuItem>
                                ))}
                              </TextField>
                              <IconButton
                                size="small"
                                aria-label={`Eliminar recordatorio ${index + 1}`}
                                disabled={disabled || !value.remindersEnabled}
                                onClick={() =>
                                  change(
                                    'reminderHours',
                                    value.reminderHours.filter((_, position) => position !== index),
                                  )
                                }
                              >
                                <Trash2 size={17} aria-hidden />
                              </IconButton>
                            </Stack>
                          ))}
                          <Button
                            size="small"
                            startIcon={<Plus size={16} aria-hidden />}
                            sx={{ alignSelf: 'flex-start' }}
                            disabled={
                              disabled || !value.remindersEnabled || value.reminderHours.length >= 3
                            }
                            onClick={() =>
                              change('reminderHours', [
                                ...value.reminderHours,
                                reminderOptions.find(
                                  (hours) => !value.reminderHours.includes(hours),
                                )!,
                              ])
                            }
                          >
                            Agregar recordatorio
                          </Button>
                          {value.remindersEnabled && !value.reminderHours.length && (
                            <Alert severity="warning">
                              Agregá al menos un recordatorio o desactivá los recordatorios
                              automáticos.
                            </Alert>
                          )}
                        </Stack>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
                <Card component="section" aria-labelledby="customer-actions-title">
                  <CardContent>
                    <Stack spacing={1.25}>
                      <Box>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                          <Box
                            component={CalendarDays}
                            size={19}
                            sx={{ color: 'primary.main', flexShrink: 0 }}
                            aria-hidden
                          />
                          <Typography
                            id="customer-actions-title"
                            component="h3"
                            sx={{ fontSize: 17, fontWeight: 600 }}
                          >
                            Gestión de turnos por parte del cliente
                          </Typography>
                        </Stack>
                        <Typography sx={{ fontSize: 12 }} color="text.secondary">
                          Se aplica también a los enlaces enviados anteriormente.
                        </Typography>
                      </Box>
                      <FormControlLabel
                        label="Permitir confirmación mediante enlace"
                        control={
                          <Switch
                            size="small"
                            checked={value.customerConfirmationEnabled}
                            disabled={disabled}
                            onChange={(_, next) => change('customerConfirmationEnabled', next)}
                          />
                        }
                      />
                      <Divider />
                      <Stack spacing={1}>
                        <FormControlLabel
                          label="Permitir que el cliente cancele por enlace"
                          control={
                            <Switch
                              size="small"
                              checked={value.customerCancellationEnabled}
                              disabled={disabled}
                              onChange={(_, next) => change('customerCancellationEnabled', next)}
                            />
                          }
                        />
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                        >
                          <Typography
                            component="label"
                            htmlFor="cancellation-hours"
                            sx={{ fontSize: 13 }}
                          >
                            Anticipación mínima (horas)
                          </Typography>
                          <TextField
                            id="cancellation-hours"
                            type="number"
                            size="small"
                            value={cancellationHours}
                            disabled={disabled || !value.customerCancellationEnabled}
                            error={!validHours(cancellationHours)}
                            slotProps={{
                              htmlInput: {
                                min: 0,
                                max: 720,
                                step: 1,
                                'aria-label': 'Anticipación mínima para cancelar (horas)',
                                'aria-describedby': 'minimum-hours-hint',
                              },
                            }}
                            sx={{ width: 88, flexShrink: 0 }}
                            onChange={(event) =>
                              setMinimumHours({
                                ...minimumHours,
                                cancellationMinimumHours: event.target.value,
                              })
                            }
                          />
                        </Stack>
                      </Stack>
                      <Divider />
                      <Stack spacing={1}>
                        <FormControlLabel
                          label="Permitir solicitudes de reprogramación por enlace"
                          control={
                            <Switch
                              size="small"
                              checked={value.customerRescheduleEnabled}
                              disabled={disabled}
                              onChange={(_, next) => change('customerRescheduleEnabled', next)}
                            />
                          }
                        />
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                        >
                          <Typography
                            component="label"
                            htmlFor="reschedule-hours"
                            sx={{ fontSize: 13 }}
                          >
                            Anticipación mínima (horas)
                          </Typography>
                          <TextField
                            id="reschedule-hours"
                            type="number"
                            size="small"
                            value={rescheduleHours}
                            disabled={disabled || !value.customerRescheduleEnabled}
                            error={!validHours(rescheduleHours)}
                            slotProps={{
                              htmlInput: {
                                min: 0,
                                max: 720,
                                step: 1,
                                'aria-label':
                                  'Anticipación mínima para solicitar un cambio (horas)',
                                'aria-describedby': 'minimum-hours-hint reschedule-approval-hint',
                              },
                            }}
                            sx={{ width: 88, flexShrink: 0 }}
                            onChange={(event) =>
                              setMinimumHours({
                                ...minimumHours,
                                rescheduleMinimumHours: event.target.value,
                              })
                            }
                          />
                        </Stack>
                        <Typography
                          id="reschedule-approval-hint"
                          sx={{ fontSize: 12 }}
                          color="text.secondary"
                        >
                          Requiere aprobación del negocio. El turno original se conserva hasta su
                          aceptación.
                        </Typography>
                      </Stack>
                      <Typography
                        id="minimum-hours-hint"
                        sx={{ fontSize: 12 }}
                        color="text.secondary"
                      >
                        De 0 a 720 horas. Con 0, hasta el inicio del turno.
                      </Typography>
                    </Stack>
                  </CardContent>
                </Card>
              </Box>
              {error && <Alert severity="error">{error}</Alert>}
              {editable && (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    position: 'sticky',
                    bottom: 12,
                    zIndex: 2,
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    flexWrap: 'wrap',
                    rowGap: 1,
                    p: 1,
                    bgcolor: 'background.paper',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 2,
                    boxShadow: 1,
                  }}
                >
                  {dirty && (
                    <Typography
                      role="status"
                      sx={{ mr: 'auto', fontSize: 12, flexBasis: { xs: '100%', sm: 'auto' } }}
                      color="warning.main"
                    >
                      Cambios sin guardar
                    </Typography>
                  )}
                  <Button
                    size="small"
                    disabled={!dirty || saving}
                    onClick={() => {
                      setDraft(undefined);
                      setMinimumHours({});
                      setError('');
                    }}
                  >
                    Descartar
                  </Button>
                  <Button
                    size="small"
                    type="submit"
                    variant="contained"
                    disabled={!dirty || saving || !hoursValid || !remindersValid || !parsed.success}
                  >
                    {saving ? 'Guardando…' : 'Guardar cambios'}
                  </Button>
                </Stack>
              )}
            </>
          )}
        </Stack>
      </Box>
      {showPreview && <EmailPreview onClose={() => setShowPreview(false)} />}
    </Box>
  );
}

function EmailPreview({ onClose }: { onClose(): void }) {
  const [kind, setKind] = useState('BOOKED');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    preview?: EmailPreviewDto;
    error?: string;
  }>();
  const key = kind + '/' + revision;
  const current = result?.key === key ? result : undefined;
  useEffect(() => {
    let active = true;
    api<EmailPreviewDto>(path + '/preview/' + kind).then(
      (preview) => {
        if (active) setResult({ key, preview });
      },
      (err) => {
        if (active) setResult({ key, error: errorMessage(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [key, kind]);
  return (
    <Dialog
      open
      fullWidth
      maxWidth="md"
      onClose={onClose}
      aria-labelledby="email-preview-title"
      slotProps={{
        paper: {
          sx: {
            width: 'calc(100% - 32px)',
            maxWidth: 680,
            m: 2,
            height: 'min(840px, calc(100dvh - 32px))',
            maxHeight: 'calc(100dvh - 32px)',
            overflow: 'hidden',
          },
        },
      }}
    >
      <DialogTitle id="email-preview-title" sx={{ px: 2, pt: 2, pb: 1 }}>
        Vista previa de emails
      </DialogTitle>
      <Box sx={{ px: 2, pt: 1, pb: 2, flexShrink: 0 }}>
        <TextField
          select
          fullWidth
          size="small"
          label="Tipo de email"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          {emailPreviewKindSchema.options.map((option) => (
            <MenuItem key={option} value={option}>
              {previewLabels[option]}
            </MenuItem>
          ))}
        </TextField>
        {current?.preview && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {current.preview.subject}
          </Typography>
        )}
      </Box>
      <DialogContent
        dividers
        sx={{ p: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
      >
        {!current && <LinearProgress aria-label="Cargando vista previa" />}
        {current?.error && (
          <Alert
            severity="error"
            sx={{ m: 2 }}
            action={<Button onClick={() => setRevision(revision + 1)}>Reintentar</Button>}
          >
            {current.error}
          </Alert>
        )}
        {current?.preview && (
          <Box
            component="iframe"
            title="Contenido del email"
            sandbox=""
            srcDoc={current.preview.html}
            sx={{
              width: '100%',
              height: '100%',
              flex: 1,
              minHeight: 0,
              border: 0,
              display: 'block',
            }}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5, flexShrink: 0 }}>
        <Button onClick={onClose}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  );
}
