'use client';

import type { AppointmentDto, CustomerDto } from '@turnosmart/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';

const CONCURRENT_LOOKUPS = 6;
const EMPTY_NAMES: ReadonlyMap<string, string> = new Map();

export function useAgendaCustomerNames(
  appointments: readonly AppointmentDto[],
  customerRevision: number,
): ReadonlyMap<string, string> {
  const ids = [...new Set(appointments.map((item) => item.customerId))].sort().join(',');
  const cache = useRef<{
    revision: number;
    names: Map<string, string>;
    pending: Map<string, Promise<void>>;
  } | null>(null);
  const [result, setResult] = useState<{
    revision: number;
    names: ReadonlyMap<string, string>;
  } | null>(null);

  useEffect(() => {
    if (!ids) return;
    let current = true;
    if (cache.current?.revision !== customerRevision) {
      cache.current = { revision: customerRevision, names: new Map(), pending: new Map() };
    }
    const { names, pending } = cache.current;
    const missing = ids.split(',').filter((id) => !names.has(id));
    async function load() {
      for (let offset = 0; current && offset < missing.length; offset += CONCURRENT_LOOKUPS) {
        await Promise.all(
          missing.slice(offset, offset + CONCURRENT_LOOKUPS).map((id) => {
            const existing = pending.get(id);
            if (existing) return existing;
            const request = api<CustomerDto>('/api/customers/' + encodeURIComponent(id))
              .then(
                (customer) => void names.set(id, customer.fullName),
                (error) => {
                  if (error instanceof ApiError && error.status === 404) names.set(id, '');
                },
              )
              .finally(() => pending.delete(id));
            pending.set(id, request);
            return request;
          }),
        );
        if (current) setResult({ revision: customerRevision, names: new Map(names) });
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [ids, customerRevision]);

  return result?.revision === customerRevision ? result.names : EMPTY_NAMES;
}
