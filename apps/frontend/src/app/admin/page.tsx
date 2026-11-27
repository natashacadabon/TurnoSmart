'use client';

import AddBusinessRoundedIcon from '@mui/icons-material/AddBusinessRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import EmailRoundedIcon from '@mui/icons-material/EmailRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { AdminBusinessDto, OwnerInvitationDto } from '@turnosmart/shared';
import { useEffect, useState } from 'react';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { DEFAULT_TIMEZONE } from '@/lib/timezones';

export default function PlatformAdminPage() {
  const { me, status, signOut } = useAuth();
  const [businesses, setBusinesses] = useState<AdminBusinessDto[]>([]);
  const [selected, setSelected] = useState<AdminBusinessDto | null>(null);
  const [invitations, setInvitations] = useState<OwnerInvitationDto[]>([]);
  const [businessName, setBusinessName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadBusinesses() {
    setLoading(true);
    try {
      const rows = await api<AdminBusinessDto[]>('/api/admin/businesses');
      setBusinesses(rows);
      setSelected((current) => rows.find((row) => row.id === current?.id) ?? rows[0] ?? null);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadInvitations(business: AdminBusinessDto) {
    try {
      setInvitations(
        await api<OwnerInvitationDto[]>(`/api/admin/businesses/${business.id}/invitations`),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    if (status !== 'signedIn' || !me?.platformAdmin) return;
    const timer = window.setTimeout(() => void loadBusinesses(), 0);
    return () => window.clearTimeout(timer);
  }, [status, me?.platformAdmin]);

  useEffect(() => {
    if (!selected) return;
    const timer = window.setTimeout(() => void loadInvitations(selected), 0);
    return () => window.clearTimeout(timer);
  }, [selected]);

  if (status !== 'signedIn' || !me?.platformAdmin) return null;

  async function createBusiness() {
    setSaving(true);
    setError(null);
    try {
      await api<AdminBusinessDto>('/api/admin/businesses', {
        method: 'POST',
        body: { name: businessName, timezone: DEFAULT_TIMEZONE },
      });
      setBusinessName('');
      await loadBusinesses();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function inviteOwner() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setToken(null);
    try {
      const invitation = await api<OwnerInvitationDto>(
        `/api/admin/businesses/${selected.id}/invitations`,
        { method: 'POST', body: { email: ownerEmail, fullName: ownerName || undefined } },
      );
      setOwnerEmail('');
      setOwnerName('');
      setToken(invitation.token ?? null);
      await loadInvitations(selected);
      await loadBusinesses();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleBusiness() {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await api<AdminBusinessDto>(`/api/admin/businesses/${selected.id}`, {
        method: 'PATCH',
        body: { active: !selected.active },
      });
      setSelected(updated);
      await loadBusinesses();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function resendInvitation(invitation: OwnerInvitationDto) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api<OwnerInvitationDto>(
        `/api/admin/businesses/${selected.id}/invitations/${invitation.id}/resend`,
        { method: 'POST' },
      );
      setToken(next.token ?? null);
      await loadInvitations(selected);
      await loadBusinesses();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleOwner(ownerId: string, active: boolean) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/admin/businesses/${selected.id}/owners/${ownerId}`, {
        method: 'PATCH',
        body: { active: !active },
      });
      await loadBusinesses();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function revokeInvitation(invitation: OwnerInvitationDto) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await api<void>(`/api/admin/businesses/${selected.id}/invitations/${invitation.id}`, {
        method: 'DELETE',
      });
      await loadInvitations(selected);
      await loadBusinesses();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function copyToken() {
    if (token) await navigator.clipboard.writeText(token);
  }

  return (
    <AuthLayout>
      <Stack spacing={3} sx={{ maxWidth: 860, width: '100%' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ justifyContent: 'space-between', gap: 2 }}
        >
          <Box>
            <Typography variant="overline" color="primary">
              Administración global
            </Typography>
            <Typography variant="h1">Panel de plataforma</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Gestioná negocios e invitá a sus OWNERS. Esta cuenta no accede a turnos ni datos
              operativos.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignSelf: { sm: 'flex-start' } }}>
            <IconButton
              aria-label="Actualizar"
              onClick={() => void loadBusinesses()}
              disabled={loading}
            >
              <RefreshRoundedIcon />
            </IconButton>
            <Button
              startIcon={<LogoutRoundedIcon />}
              variant="outlined"
              onClick={() => void signOut()}
            >
              Salir
            </Button>
          </Stack>
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}
        {token && (
          <Alert
            severity="success"
            action={
              <IconButton aria-label="Copiar invitación" onClick={() => void copyToken()}>
                <ContentCopyRoundedIcon />
              </IconButton>
            }
          >
            Invitación creada. Compartí este token con el OWNER:{' '}
            <Box component="code" sx={{ wordBreak: 'break-all' }}>
              {token}
            </Box>
          </Alert>
        )}

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <AddBusinessRoundedIcon color="primary" />
                <Typography variant="h2">Nuevo negocio</Typography>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  fullWidth
                  label="Nombre del negocio"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
                <Button
                  variant="contained"
                  onClick={() => void createBusiness()}
                  disabled={saving || !businessName.trim()}
                >
                  Crear
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {loading ? (
          <CircularProgress aria-label="Cargando negocios" />
        ) : businesses.length === 0 ? (
          <Alert severity="info">Todavía no hay negocios registrados.</Alert>
        ) : (
          <Stack spacing={1.5}>
            {businesses.map((business) => (
              <Card
                key={business.id}
                variant={selected?.id === business.id ? 'elevation' : 'outlined'}
                sx={{ cursor: 'pointer' }}
                onClick={() => setSelected(business)}
              >
                <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    sx={{ justifyContent: 'space-between', gap: 1.5 }}
                  >
                    <Box>
                      <Typography variant="h2">{business.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {business.owner
                          ? `${business.owner.fullName ?? 'OWNER'} · ${business.owner.email}`
                          : 'Sin OWNER asignado'}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Chip
                        size="small"
                        label={business.active ? 'Activo' : 'Inactivo'}
                        color={business.active ? 'success' : 'default'}
                        icon={business.active ? <CheckCircleRoundedIcon /> : <BlockRoundedIcon />}
                      />
                      <Chip
                        size="small"
                        label={`${business.pendingInvitations} pendientes`}
                        variant="outlined"
                      />
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}

        {selected && (
          <Card>
            <CardContent>
              <Stack spacing={2.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  sx={{ justifyContent: 'space-between', gap: 1 }}
                >
                  <Box>
                    <Typography variant="h2">Administrar {selected.name}</Typography>
                    <Typography color="text.secondary">
                      Zona horaria: {selected.timezone}
                    </Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    onClick={() => void toggleBusiness()}
                    disabled={saving}
                  >
                    {selected.active ? 'Desactivar' : 'Activar'}
                  </Button>
                </Stack>
                <Divider />
                <Stack spacing={1}>
                  <Typography variant="h2">OWNERS</Typography>
                  {selected.owners.length === 0 ? (
                    <Typography color="text.secondary">Sin OWNER asignado.</Typography>
                  ) : (
                    selected.owners.map((owner) => (
                      <Stack
                        key={owner.id}
                        direction="row"
                        sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}
                      >
                        <Typography variant="body2">
                          {owner.fullName ?? owner.email} · {owner.email}
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Chip size="small" label={owner.active ? 'Activo' : 'Inactivo'} />
                          <Button
                            size="small"
                            onClick={() => void toggleOwner(owner.id, owner.active)}
                            disabled={
                              saving ||
                              (owner.active &&
                                selected.owners.filter((item) => item.active).length <= 1)
                            }
                          >
                            {owner.active ? 'Desactivar' : 'Activar'}
                          </Button>
                        </Stack>
                      </Stack>
                    ))
                  )}
                </Stack>
                <Divider />
                <Stack spacing={1.5}>
                  <Typography variant="h2">Invitar OWNER</Typography>
                  <TextField
                    label="Email del OWNER"
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <EmailRoundedIcon sx={{ mr: 1, color: 'text.secondary' }} />
                        ),
                      },
                    }}
                  />
                  <TextField
                    label="Nombre (opcional)"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                  />
                  <Button
                    variant="contained"
                    onClick={() => void inviteOwner()}
                    disabled={saving || !ownerEmail.trim()}
                  >
                    Generar invitación
                  </Button>
                </Stack>
                <Divider />
                <Stack spacing={1}>
                  <Typography variant="h2">Invitaciones</Typography>
                  {invitations.length === 0 ? (
                    <Typography color="text.secondary">No hay invitaciones.</Typography>
                  ) : (
                    invitations.map((invitation) => (
                      <Stack
                        key={invitation.id}
                        direction="row"
                        sx={{
                          justifyContent: 'space-between',
                          gap: 1,
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <Typography variant="body2">{invitation.email}</Typography>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Chip size="small" label={invitation.status} />
                          <Button
                            size="small"
                            onClick={() => void resendInvitation(invitation)}
                            disabled={saving || invitation.status === 'ACCEPTED'}
                          >
                            Reenviar
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => void revokeInvitation(invitation)}
                            disabled={saving || invitation.status !== 'PENDING'}
                          >
                            Revocar
                          </Button>
                        </Stack>
                      </Stack>
                    ))
                  )}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </AuthLayout>
  );
}
