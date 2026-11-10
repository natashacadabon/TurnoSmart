'use client';

import { Alert, Button, Stack, Typography } from '@mui/material';
import { can, type ListServicesResponse, type ServiceDto } from '@turnosmart/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { ServicesPanel } from '@/components/services/ServicesPanel';
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
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <Typography component="h1" variant="h4">
        Servicios
      </Typography>
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
      {services && (
        <ServicesPanel
          services={services}
          canWrite={can(role, 'services:write')}
          onChanged={servicesChanged}
        />
      )}
      {can(role, 'availability:read') && (
        <WeeklyAvailability canWrite={can(role, 'availability:write')} onSaved={invalidateSlots} />
      )}
      {services && can(role, 'slots:read') && !error && !refreshing && (
        <SlotsPanel key={slotRevision} services={services} timezone={timezone} />
      )}
    </Stack>
  );
}
