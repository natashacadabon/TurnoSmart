import { AppointmentStatus, ProfileRole } from '@prisma/client';
import { calculateNoShowRisk } from '../src/modules/ai/risk-calculator.js';

export const SEED_TIME_ZONE = 'America/Argentina/Buenos_Aires';
/** ADMIN global de la plataforma (business_id NULL). */
export const SEED_ADMIN_EMAIL = 'admin@turnosmart.test';
/** OWNER del negocio demo 1; comparte la contraseña del seed para iniciar sesión en local. */
export const SEED_OWNER_EMAIL = 'owner@turnosmart.test';
export const seedId = (kind: number, business: number, index = 0) =>
  `d${kind}000000-0000-4000-8000-${String(business * 100 + index).padStart(12, '0')}`;

function localDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEED_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}

/** Convierte la hora civil usando IANA, sin depender de la zona del proceso. */
function businessDate(now: Date, direction: -1 | 1, hour: number) {
  const day = localDate(now);
  do {
    day.setUTCDate(day.getUTCDate() + direction);
  } while ([0, 6].includes(day.getUTCDay()));
  const target = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour);
  let instant = new Date(target);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: SEED_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    const civil = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    if (civil === target) return instant;
    instant = new Date(instant.getTime() + target - civil);
  }
  throw new Error('No se pudo resolver la fecha IANA de los datos de prueba.');
}
const time = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour));

export function buildSeedData(now = new Date()) {
  const businesses = [1, 2].map((b) => ({
    id: seedId(1, b),
    name: `Demo TurnoSmart ${b}`,
    timezone: SEED_TIME_ZONE,
  }));
  const accounts = [
    {
      businessId: null,
      email: SEED_ADMIN_EMAIL,
      role: ProfileRole.ADMIN,
      fullName: 'Administrador de plataforma',
    },
    {
      businessId: businesses[0]!.id,
      email: SEED_OWNER_EMAIL,
      role: ProfileRole.OWNER,
      fullName: 'Owner Demo 1',
    },
    {
      businessId: businesses[1]!.id,
      email: 'owner2@turnosmart.test',
      role: ProfileRole.OWNER,
      fullName: 'Owner Demo 2',
    },
  ];
  const customers = businesses.flatMap((b, i) =>
    [1, 2, 3, 4].map((n) => ({
      id: seedId(3, i + 1, n),
      businessId: b.id,
      fullName: `Cliente Demo ${i + 1}-${n}`,
      email: `cliente${i + 1}-${n}@turnosmart.test`,
      phone: `+54 221 555 ${i + 1}00${n}`,
      notes: 'Dato ficticio de desarrollo.',
    })),
  );
  const services = businesses.flatMap((b, i) =>
    [
      { name: 'Consulta demo', durationMinutes: 30, priceCents: 0, active: true },
      { name: 'Sesion demo', durationMinutes: 60, priceCents: 250000, active: true },
      { name: 'Tratamiento demo', durationMinutes: 90, priceCents: 480000, active: true },
      { name: 'Servicio archivado demo', durationMinutes: 45, priceCents: null, active: false },
    ].map((s, n) => ({
      ...s,
      id: seedId(2, i + 1, n + 1),
      businessId: b.id,
      description: 'Servicio ficticio de desarrollo.',
    })),
  );
  const rules = businesses.flatMap((b, i) =>
    [1, 2, 3, 4, 5].flatMap((dayOfWeek) =>
      [
        { startTime: time(9), endTime: time(12) },
        { startTime: time(14), endTime: time(18) },
      ].map((r, n) => ({
        ...r,
        id: seedId(5, i + 1, dayOfWeek * 2 + n),
        businessId: b.id,
        dayOfWeek,
        active: true,
      })),
    ),
  );
  const appointments = businesses.flatMap((b, i) =>
    [
      {
        status: AppointmentStatus.SCHEDULED,
        direction: 1 as const,
        hour: 9,
        service: 1,
        duration: 30,
      },
      {
        status: AppointmentStatus.SCHEDULED,
        confirmationStatus: 'CONFIRMED' as const,
        direction: 1 as const,
        hour: 10,
        service: 2,
        duration: 60,
      },
      {
        status: AppointmentStatus.COMPLETED,
        direction: -1 as const,
        hour: 9,
        service: 1,
        duration: 30,
      },
      {
        status: AppointmentStatus.NO_SHOW,
        direction: -1 as const,
        hour: 10,
        service: 2,
        duration: 60,
      },
      {
        status: AppointmentStatus.CANCELLED,
        direction: 1 as const,
        hour: 15,
        service: 4,
        duration: 45,
      },
    ].map((a, n) => {
      const startsAt = businessDate(now, a.direction, a.hour);
      return {
        id: seedId(4, i + 1, n + 1),
        businessId: b.id,
        serviceId: seedId(2, i + 1, a.service),
        customerId: seedId(3, i + 1, SEED_CUSTOMER_BY_APPOINTMENT[n]!),
        startsAt,
        endsAt: new Date(startsAt.getTime() + a.duration * 60_000),
        status: a.status,
        confirmationStatus: a.confirmationStatus ?? ('PENDING' as const),
        notes: 'Turno ficticio de desarrollo.',
      };
    }),
  );
  return { businesses, accounts, customers, services, rules, appointments };
}
export type SeedData = ReturnType<typeof buildSeedData>;

/**
 * Cliente (1-4) de cada turno demo y horas de anticipación con que se reservó. Los turnos futuros
 * quedan asignados a clientes con historial para que el score y la explicación de IA usen
 * factores reales: el cliente 4 faltó antes y reservó con poca anticipación; el 3 asistió y
 * ya confirmó; el 1 no tiene historial.
 */
export const SEED_CUSTOMER_BY_APPOINTMENT = [4, 3, 3, 4, 1] as const;
export const SEED_BOOKING_LEAD_HOURS = [20, 96, 120, 120, 120] as const;

/** Score real del turno demo con el mismo calculador que usa la API al reservar. */
export function seedRiskScore(data: SeedData, appointment: SeedData['appointments'][number]) {
  const index = Number(appointment.id.slice(-2)) - 1;
  const leadHours = SEED_BOOKING_LEAD_HOURS[index] ?? 120;
  const past = data.appointments.filter(
    (other) =>
      other.businessId === appointment.businessId &&
      other.customerId === appointment.customerId &&
      other.startsAt < appointment.startsAt &&
      other.status !== AppointmentStatus.SCHEDULED,
  );
  return calculateNoShowRisk({
    startsAt: appointment.startsAt,
    now: new Date(appointment.startsAt.getTime() - leadHours * 3_600_000),
    history: {
      total: past.length,
      completed: past.filter((a) => a.status === AppointmentStatus.COMPLETED).length,
      noShows: past.filter((a) => a.status === AppointmentStatus.NO_SHOW).length,
      cancelled: past.filter((a) => a.status === AppointmentStatus.CANCELLED).length,
    },
    confirmed: appointment.confirmationStatus === 'CONFIRMED',
  });
}
type Interval = { businessId: string; startsAt: Date; endsAt: Date; status: AppointmentStatus };
export function assertNoActiveOverlaps(rows: Interval[]) {
  const active = rows.filter((a) => a.status === 'SCHEDULED');
  for (let i = 0; i < active.length; i++) {
    const a = active[i]!;
    if (a.startsAt >= a.endsAt) throw new Error('Intervalo de prueba invalido.');
    for (const b of active.slice(i + 1)) {
      if (a.businessId === b.businessId && a.startsAt < b.endsAt && b.startsAt < a.endsAt) {
        throw new Error(
          'Hay turnos activos superpuestos; seed cancelado sin modificar datos de negocio.',
        );
      }
    }
  }
}

export function validateSeedData(data: SeedData) {
  const businessIds = new Set(data.businesses.map((b) => b.id));
  for (const rows of [
    data.businesses,
    data.customers,
    data.services,
    data.rules,
    data.appointments,
  ]) {
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new Error('IDs de seed duplicados.');
  }
  for (const a of data.appointments) {
    const service = data.services.find(
      (s) => s.id === a.serviceId && s.businessId === a.businessId,
    );
    const customer = data.customers.find(
      (c) => c.id === a.customerId && c.businessId === a.businessId,
    );
    if (
      !businessIds.has(a.businessId) ||
      !service ||
      !customer ||
      a.endsAt <= a.startsAt ||
      a.endsAt.getTime() - a.startsAt.getTime() !== service.durationMinutes * 60_000
    )
      throw new Error('Relacion o duracion de seed invalida.');
  }
  for (const row of [...data.customers, ...data.services, ...data.rules]) {
    if (!businessIds.has(row.businessId)) throw new Error('Registro de seed fuera de su negocio.');
  }
  for (const account of data.accounts) {
    if (account.role === ProfileRole.ADMIN && account.businessId !== null)
      throw new Error('El ADMIN de seed no puede tener negocio.');
    if (account.role === ProfileRole.OWNER && !account.businessId)
      throw new Error('El OWNER de seed debe tener negocio.');
  }
  if (new Set(data.accounts.map((a) => a.email)).size !== data.accounts.length)
    throw new Error('Emails de prueba duplicados.');
  for (const rule of data.rules) {
    if (rule.dayOfWeek < 0 || rule.dayOfWeek > 6 || rule.startTime >= rule.endTime)
      throw new Error('Regla semanal invalida.');
    if (
      data.rules.some(
        (other) =>
          other.id !== rule.id &&
          other.businessId === rule.businessId &&
          other.dayOfWeek === rule.dayOfWeek &&
          other.startTime < rule.endTime &&
          rule.startTime < other.endTime,
      )
    )
      throw new Error('Franjas semanales superpuestas.');
  }
  for (const appointment of data.appointments) {
    const parts = (date: Date) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: SEED_TIME_ZONE,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date);
    const localStart = parts(appointment.startsAt),
      localEnd = parts(appointment.endsAt);
    const minutes = (p: Intl.DateTimeFormatPart[]) =>
      Number(p.find((x) => x.type === 'hour')!.value) * 60 +
      Number(p.find((x) => x.type === 'minute')!.value);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      localStart.find((p) => p.type === 'weekday')!.value,
    );
    if (
      !data.rules.some(
        (r) =>
          r.businessId === appointment.businessId &&
          r.active &&
          r.dayOfWeek === day &&
          minutes(localStart) >= r.startTime.getUTCHours() * 60 &&
          minutes(localEnd) <= r.endTime.getUTCHours() * 60 &&
          (minutes(localStart) - r.startTime.getUTCHours() * 60) % 15 === 0,
      )
    )
      throw new Error('Turno de seed fuera de disponibilidad.');
    if (
      appointment.status === 'SCHEDULED' &&
      !data.services.find((s) => s.id === appointment.serviceId)!.active
    )
      throw new Error('Turno activo con servicio inactivo.');
  }
  assertNoActiveOverlaps(data.appointments);
}
