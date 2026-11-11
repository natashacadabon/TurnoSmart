import type {
  AppointmentDto,
  AppointmentsResponse,
  ListServicesResponse,
  ServiceDto,
} from '@turnosmart/shared';
import { api } from './api';

export async function listAgendaServices(active: 'true' | 'all', isCurrent: () => boolean) {
  const services: ServiceDto[] = [];
  for (let offset = 0; isCurrent();) {
    const result = await api<ListServicesResponse>(
      '/api/services?' + new URLSearchParams({ active, limit: '100', offset: String(offset) }),
    );
    services.push(...result.data);
    offset += result.data.length;
    if (offset >= result.meta.total) break;
    if (!result.data.length) throw new Error('No se pudo completar la lista de servicios.');
  }
  return services;
}

export async function listAgendaAppointments(
  { from, to }: { from: string; to: string },
  isCurrent: () => boolean,
) {
  const appointments = new Map<string, AppointmentDto>();
  const pageSize = 100;
  for (let page = 1; isCurrent(); page++) {
    const params = new URLSearchParams({
      from,
      to,
      page: String(page),
      pageSize: String(pageSize),
    });
    const result = await api<AppointmentsResponse>('/api/appointments?' + params);
    for (const item of result.items) appointments.set(item.id, item);
    if (page * pageSize >= result.total || !result.items.length) break;
  }
  return [...appointments.values()];
}
