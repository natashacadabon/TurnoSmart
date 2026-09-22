import {
  AppointmentEventType,
  AppointmentStatus,
  PrismaClient,
  ProfileRole,
  ReminderChannel,
  ReminderStatus,
  RiskLevel,
} from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const prisma = new PrismaClient();
const DEMO_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const ids = {
  business: '10000000-0000-4000-8000-000000000001',
  services: {
    haircut: '20000000-0000-4000-8000-000000000001',
    color: '20000000-0000-4000-8000-000000000002',
    consultation: '20000000-0000-4000-8000-000000000003',
  },
  customers: {
    ana: '30000000-0000-4000-8000-000000000001',
    julia: '30000000-0000-4000-8000-000000000002',
    maria: '30000000-0000-4000-8000-000000000003',
  },
  appointments: {
    ana: '40000000-0000-4000-8000-000000000001',
    julia: '40000000-0000-4000-8000-000000000002',
    maria: '40000000-0000-4000-8000-000000000003',
  },
};

function dateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function dateAtTimeZone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  let result = new Date(utcGuess);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = dateTimeParts(result, timeZone);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    result = new Date(result.getTime() + utcGuess - representedAsUtc);
  }

  return result;
}

function nextBusinessDayAt(hour: number, minute = 0) {
  const today = dateTimeParts(new Date(), DEMO_TIME_ZONE);
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));

  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return dateAtTimeZone(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    hour,
    minute,
    DEMO_TIME_ZONE,
  );
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function timeAt(hour: number, minute = 0) {
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
}

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error(
      'Production seed blocked. Set ALLOW_PRODUCTION_SEED=true to run intentionally.',
    );
  }
}

function optionalAuthUserId() {
  const value = process.env.SEED_AUTH_USER_ID?.trim();

  if (!value) {
    return null;
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(value)) {
    throw new Error('SEED_AUTH_USER_ID must be an existing Supabase Auth user UUID.');
  }

  return value;
}

async function seedBusiness() {
  return prisma.business.upsert({
    where: { id: ids.business },
    update: {
      name: 'Estudio Aurora',
      timezone: DEMO_TIME_ZONE,
    },
    create: {
      id: ids.business,
      name: 'Estudio Aurora',
      timezone: DEMO_TIME_ZONE,
    },
  });
}

async function seedOptionalProfile() {
  const authUserId = optionalAuthUserId();
  if (!authUserId) {
    console.info('Profile skipped: set SEED_AUTH_USER_ID to link an existing Supabase Auth user.');
    return;
  }

  await prisma.profile.upsert({
    where: { id: authUserId },
    update: {
      businessId: ids.business,
      email: process.env.SEED_AUTH_USER_EMAIL?.trim() || 'owner@example.com',
      fullName: 'Demo Owner',
      role: ProfileRole.OWNER,
    },
    create: {
      id: authUserId,
      businessId: ids.business,
      email: process.env.SEED_AUTH_USER_EMAIL?.trim() || 'owner@example.com',
      fullName: 'Demo Owner',
      role: ProfileRole.OWNER,
    },
  });
}

async function seedServices() {
  const services = [
    {
      id: ids.services.haircut,
      name: 'Corte y peinado',
      description: 'Corte, lavado y peinado.',
      durationMinutes: 60,
      priceCents: 250000,
    },
    {
      id: ids.services.color,
      name: 'Coloracion',
      description: 'Servicio de color y terminacion.',
      durationMinutes: 120,
      priceCents: 480000,
    },
    {
      id: ids.services.consultation,
      name: 'Consulta profesional',
      description: 'Consulta inicial personalizada.',
      durationMinutes: 45,
      priceCents: 180000,
    },
  ];

  await Promise.all(
    services.map((service) =>
      prisma.service.upsert({
        where: { id: service.id },
        update: { ...service, businessId: ids.business, active: true },
        create: { ...service, businessId: ids.business, active: true },
      }),
    ),
  );
}

async function seedCustomers() {
  const customers = [
    {
      id: ids.customers.ana,
      fullName: 'Ana Perez',
      email: 'ana.perez@example.com',
      phone: '+54 11 5555 0101',
    },
    {
      id: ids.customers.julia,
      fullName: 'Julia Gomez',
      email: 'julia.gomez@example.com',
      phone: '+54 11 5555 0102',
    },
    {
      id: ids.customers.maria,
      fullName: 'Maria Lopez',
      email: 'maria.lopez@example.com',
      phone: '+54 11 5555 0103',
      notes: 'Primera visita.',
    },
  ];

  await Promise.all(
    customers.map((customer) =>
      prisma.customer.upsert({
        where: { id: customer.id },
        update: { ...customer, businessId: ids.business },
        create: { ...customer, businessId: ids.business },
      }),
    ),
  );
}

async function seedAvailability() {
  const rules = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    id: `50000000-0000-4000-8000-00000000000${dayOfWeek}`,
    dayOfWeek,
    startTime: timeAt(9),
    endTime: timeAt(18),
  }));

  await Promise.all(
    rules.map((rule) =>
      prisma.availabilityRule.upsert({
        where: { id: rule.id },
        update: { ...rule, businessId: ids.business, active: true },
        create: { ...rule, businessId: ids.business, active: true },
      }),
    ),
  );
}

async function seedAppointments() {
  const baseDate = nextBusinessDayAt(9);
  const appointments = [
    {
      id: ids.appointments.ana,
      customerId: ids.customers.ana,
      serviceId: ids.services.haircut,
      startsAt: baseDate,
      endsAt: addMinutes(baseDate, 60),
      status: AppointmentStatus.CONFIRMED,
    },
    {
      id: ids.appointments.julia,
      customerId: ids.customers.julia,
      serviceId: ids.services.color,
      startsAt: nextBusinessDayAt(10, 30),
      endsAt: addMinutes(nextBusinessDayAt(10, 30), 120),
      status: AppointmentStatus.SCHEDULED,
    },
    {
      id: ids.appointments.maria,
      customerId: ids.customers.maria,
      serviceId: ids.services.consultation,
      startsAt: nextBusinessDayAt(15),
      endsAt: addMinutes(nextBusinessDayAt(15), 45),
      status: AppointmentStatus.SCHEDULED,
      notes: 'Confirmar antes del mediodia.',
    },
  ];

  await Promise.all(
    appointments.map((appointment) =>
      prisma.appointment.upsert({
        where: { id: appointment.id },
        update: { ...appointment, businessId: ids.business },
        create: { ...appointment, businessId: ids.business },
      }),
    ),
  );
}

async function seedAppointmentDetails() {
  const details = [
    {
      suffix: '1',
      appointmentId: ids.appointments.ana,
      score: 18,
      level: RiskLevel.LOW,
      factors: ['Cliente frecuente', 'Sin ausencias recientes'],
    },
    {
      suffix: '2',
      appointmentId: ids.appointments.julia,
      score: 54,
      level: RiskLevel.MEDIUM,
      factors: ['Reserva con poca anticipacion'],
    },
    {
      suffix: '3',
      appointmentId: ids.appointments.maria,
      score: 82,
      level: RiskLevel.HIGH,
      factors: ['Primera visita', 'Horario de mayor riesgo'],
    },
  ];

  for (const detail of details) {
    const eventId = `60000000-0000-4000-8000-00000000000${detail.suffix}`;
    const riskId = `70000000-0000-4000-8000-00000000000${detail.suffix}`;
    const reminderId = `80000000-0000-4000-8000-00000000000${detail.suffix}`;
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: detail.appointmentId },
      select: { startsAt: true, status: true },
    });

    await prisma.appointmentEvent.upsert({
      where: { id: eventId },
      update: {
        businessId: ids.business,
        appointmentId: detail.appointmentId,
        type:
          appointment.status === AppointmentStatus.CONFIRMED
            ? AppointmentEventType.CONFIRMED
            : AppointmentEventType.CREATED,
        metadata: { source: 'seed' },
      },
      create: {
        id: eventId,
        businessId: ids.business,
        appointmentId: detail.appointmentId,
        type:
          appointment.status === AppointmentStatus.CONFIRMED
            ? AppointmentEventType.CONFIRMED
            : AppointmentEventType.CREATED,
        metadata: { source: 'seed' },
      },
    });

    await prisma.riskScore.upsert({
      where: {
        appointmentId_businessId: {
          appointmentId: detail.appointmentId,
          businessId: ids.business,
        },
      },
      update: {
        score: detail.score,
        level: detail.level,
        factors: detail.factors,
        calculatedAt: new Date(),
      },
      create: {
        id: riskId,
        businessId: ids.business,
        appointmentId: detail.appointmentId,
        score: detail.score,
        level: detail.level,
        factors: detail.factors,
      },
    });

    await prisma.reminder.upsert({
      where: { id: reminderId },
      update: {
        businessId: ids.business,
        appointmentId: detail.appointmentId,
        channel: ReminderChannel.EMAIL,
        status: ReminderStatus.PENDING,
        scheduledAt: addMinutes(appointment.startsAt, -24 * 60),
        sentAt: null,
        providerId: null,
        errorMessage: null,
      },
      create: {
        id: reminderId,
        businessId: ids.business,
        appointmentId: detail.appointmentId,
        channel: ReminderChannel.EMAIL,
        status: ReminderStatus.PENDING,
        scheduledAt: addMinutes(appointment.startsAt, -24 * 60),
      },
    });
  }
}

async function main() {
  assertSafeEnvironment();
  await seedBusiness();
  await seedOptionalProfile();
  await seedServices();
  await seedCustomers();
  await seedAvailability();
  await seedAppointments();
  await seedAppointmentDetails();

  console.info('TurnoSmart seed completed.');
}

main()
  .catch((error: unknown) => {
    console.error('TurnoSmart seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
