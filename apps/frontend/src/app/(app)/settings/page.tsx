'use client';

import LockRoundedIcon from '@mui/icons-material/LockRounded';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { can, type BusinessDto, type UpdateBusinessRequest } from '@turnosmart/shared';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader } from '@/components/ui';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { listTimezones, type TimezoneOption } from '@/lib/timezones';

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '240px 1fr' },
        gap: { xs: 1, md: 4 },
        py: 2.5,
      }}
    >
      <Box>
        <Typography variant="subtitle2">{label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
      </Box>
      <Box sx={{ maxWidth: 440 }}>{children}</Box>
    </Box>
  );
}

export default function SettingsPage() {
  const { me, refreshMe } = useAuth();
  // null = sin cambios: se muestran los valores guardados del negocio.
  const [draft, setDraft] = useState<{ name: string; timezone: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const currentTimezone = me?.onboarded ? me.business.timezone : undefined;
  const timezones = useMemo(() => listTimezones(currentTimezone), [currentTimezone]);

  if (!me?.onboarded) return null;
  const form = draft ?? { name: me.business.name, timezone: me.business.timezone };
  const setForm = setDraft;
  const editable = can(me.profile.role, 'business:update');
  const selected = timezones.find((t) => t.id === form.timezone) ?? null;
  const dirty = form.name !== me.business.name || form.timezone !== me.business.timezone;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      const body: UpdateBusinessRequest = form;
      await api<BusinessDto>('/api/business', { method: 'PATCH', body });
      await refreshMe();
      setDraft(null);
      setMessage({ type: 'success', text: 'Cambios guardados' });
    } catch (err) {
      setErrors(fieldErrors(err));
      setMessage({ type: 'error', text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Negocio"
        subtitle="Datos generales que ven todas las personas del equipo."
      />
      <Card component="form" onSubmit={onSubmit}>
        <CardContent sx={{ pb: 0 }}>
          {!editable && (
            <Alert severity="info" icon={<LockRoundedIcon fontSize="inherit" />} sx={{ mb: 1 }}>
              Sólo dueños/as y administradores/as pueden modificar estos datos.
            </Alert>
          )}
          {message && (
            <Alert severity={message.type} sx={{ mb: 1 }}>
              {message.text}
            </Alert>
          )}

          <Field label="Nombre" hint="Cómo se identifica tu negocio en TurnoSmart.">
            <TextField
              fullWidth
              size="small"
              value={form.name}
              disabled={!editable}
              error={!!errors.name}
              helperText={errors.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              slotProps={{ htmlInput: { 'aria-label': 'Nombre' } }}
            />
          </Field>
          <Divider />
          <Field label="Zona horaria" hint="Se usa para mostrar y reservar los turnos.">
            {selected && (
              <Autocomplete<TimezoneOption, false, true>
                options={timezones}
                value={selected}
                disabled={!editable}
                disableClearable
                size="small"
                getOptionLabel={(o) => `${o.city} (${o.offset})`}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                filterOptions={(options, { inputValue }) => {
                  const q = inputValue.trim().toLowerCase();
                  if (!q) return options;
                  return options.filter(
                    (o) =>
                      o.city.toLowerCase().includes(q) ||
                      o.id.toLowerCase().includes(q) ||
                      o.offset.includes(q),
                  );
                }}
                onChange={(_, option) => setForm({ ...form, timezone: option.id })}
                renderOption={({ key, ...props }, o) => (
                  <Box
                    component="li"
                    key={key}
                    {...props}
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start !important',
                    }}
                  >
                    <span>
                      {o.city}{' '}
                      <Typography component="span" variant="body2" color="text.secondary">
                        ({o.offset})
                      </Typography>
                    </span>
                    <Typography variant="caption" color="text.secondary">
                      {o.id}
                    </Typography>
                  </Box>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    error={!!errors.timezone}
                    helperText={errors.timezone ?? 'Buscá por ciudad, país o desfasaje (ej.: -03).'}
                    slotProps={{
                      ...params.slotProps,
                      htmlInput: { ...params.slotProps.htmlInput, 'aria-label': 'Zona horaria' },
                    }}
                  />
                )}
              />
            )}
          </Field>
        </CardContent>
        {editable && (
          <Stack
            direction="row"
            spacing={1}
            sx={{
              justifyContent: 'flex-end',
              px: 3,
              py: 2,
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'action.hover',
            }}
          >
            <Button disabled={!dirty || saving} onClick={() => setDraft(null)}>
              Descartar
            </Button>
            <Button type="submit" variant="contained" disabled={!dirty || saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </Stack>
        )}
      </Card>
    </>
  );
}
