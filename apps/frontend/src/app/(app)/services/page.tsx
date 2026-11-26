'use client';

import { Alert, Box, Button, Card, Stack, Typography } from '@mui/material';
import { can, type ListServicesResponse, type ServiceDto } from '@turnosmart/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Plus } from 'lucide-react';
import { ServiceDialog, ServicesPanel } from '@/components/services/ServicesPanel';
import { SlotsPanel } from '@/components/services/SlotsPanel';
import { WeeklyAvailability } from '@/components/services/WeeklyAvailability';
import { api, errorMessage } from '@/lib/api';

async function listServices() {
  const items: ServiceDto[] = [];
  for (;;) {
    const page = await api<ListServicesResponse>(
      `/api/services?active=all&limit=100&offset=${items.length}`,
    );
    items.push(...page.data);
    if (!page.data.length || items.length >= page.meta.total) return items;
  }
}

export default function ServicesPage() {
  const { me } = useAuth();
  if (!me?.onboarded) return null;
  return (
    <ServiceManagement
      key={me.business.id}
      role={me.profile.role}
      timezone={me.business.timezone}
    />
  );
}

function ServiceManagement({
  role,
  timezone,
}: {
  role: Parameters<typeof can>[0];
  timezone: string;
}) {
  const [changing, setChanging] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ service: ServiceDto | null } | null>(null);
  const [weeklyMinutes, setWeeklyMinutes] = useState<number | null>(null);
  const [services, setServices] = useState<ServiceDto[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [slotRevision, setSlotRevision] = useState(0);
  const pending = useRef<Promise<ServiceDto[]> | null>(null);
  const invalidateSlots = useCallback(() => setSlotRevision((revision) => revision + 1), []);

  const load = useCallback(() => {
    return (pending.current ??= listServices().finally(() => {
      pending.current = null;
    }));
  }, []);

  useEffect(() => {
    let mounted = true;
    void load().then(
      (items) => {
        if (mounted) setServices(items);
      },
      (err) => {
        if (mounted) setError(errorMessage(err));
      },
    );
    return () => {
      mounted = false;
    };
  }, [load]);

  async function refresh() {
    if (pending.current) return;
    setRefreshing(true);
    setError('');
    try {
      setServices(await load());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }

  async function servicesChanged() {
    invalidateSlots();
    await refresh();
  }

  return (
    <Stack
      data-services-page
      spacing={2}
      sx={{
        minWidth: 0,
        '& .MuiCard-root, & .MuiAccordion-root': {
          bgcolor: 'common.white',
          backgroundImage: 'none',
        },
      }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}
      >
        <Box>
          <Typography component="h1" variant="h1">
            Servicios
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Administrá tu catálogo y los horarios de atención.
          </Typography>
        </Box>
        {can(role, 'services:write') && (
          <Button
            variant="contained"
            size="small"
            startIcon={<Plus size={17} />}
            disabled={!services || refreshing || Boolean(changing)}
            sx={{ ml: 'auto' }}
            onClick={() => setDialog({ service: null })}
          >
            Nuevo servicio
          </Button>
        )}
      </Stack>
      <Box
        role="group"
        aria-label="Indicadores de servicios"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
          alignItems: 'stretch',
          gap: 1.5,
        }}
      >
        {[
          { value: services?.length ?? '—', label: 'servicios totales' },
          {
            value: services?.filter((service) => service.active).length ?? '—',
            label: 'servicios activos',
          },
          {
            value:
              weeklyMinutes === null
                ? '—'
                : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(
                    weeklyMinutes / 60,
                  ),
            label: 'h semanales de atención',
          },
        ].map(({ value, label }) => (
          <Card key={label} sx={{ p: 2, minWidth: 0, display: 'flex', alignItems: 'center' }}>
            <Typography component="p" sx={{ m: 0 }}>
              <Box
                component="span"
                sx={{ display: 'block', fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}
              >
                {value}
              </Box>{' '}
              <Box
                component="span"
                sx={{ display: 'block', fontSize: 13, color: 'text.secondary', mt: 0.5 }}
              >
                {label}
              </Box>
            </Typography>
          </Card>
        ))}
      </Box>
      {error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={() => void refresh()}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {!services && !error && <Typography role="status">Cargando servicios…</Typography>}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.25fr) minmax(0, 1fr)' },
          alignItems: { xs: 'start', lg: 'stretch' },
          gap: 2,
        }}
      >
        {services && (
          <ServicesPanel
            services={services}
            canWrite={can(role, 'services:write')}
            onChanged={servicesChanged}
            changing={changing}
            onChanging={setChanging}
            onEdit={(service) => setDialog({ service })}
          />
        )}
        {can(role, 'availability:read') && (
          <WeeklyAvailability
            canWrite={can(role, 'availability:write')}
            onSaved={invalidateSlots}
            onSummary={setWeeklyMinutes}
          />
        )}
      </Box>
      {services && can(role, 'slots:read') && !error && !refreshing && (
        <SlotsPanel key={slotRevision} services={services} timezone={timezone} />
      )}
      {dialog && can(role, 'services:write') && (
        <ServiceDialog
          service={dialog.service}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await servicesChanged();
          }}
        />
      )}
    </Stack>
  );
}
