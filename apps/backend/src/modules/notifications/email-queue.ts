import type { AppointmentEmailKind, AppointmentEvent, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AppointmentRecord } from '../appointments/repository.js';

const emailKinds = {
  CREATED: 'BOOKED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  RESCHEDULED: 'RESCHEDULED',
  RESCHEDULE_REQUEST_DISMISSED: 'RESCHEDULE_DECLINED',
} as const satisfies Partial<Record<AppointmentEvent['type'], AppointmentEmailKind>>;

export const emailPreference = {
  BOOKED: 'bookingEmailEnabled',
  CONFIRMED: 'confirmationEmailEnabled',
  CANCELLED: 'cancellationEmailEnabled',
  RESCHEDULED: 'rescheduleEmailEnabled',
  RESCHEDULE_DECLINED: 'rescheduleEmailEnabled',
  REMINDER_48H: 'reminder48hEnabled',
  REMINDER_24H: 'reminder24hEnabled',
  REMINDER: 'remindersEnabled',
} as const satisfies Record<AppointmentEmailKind, keyof Prisma.BusinessSelect>;

const recipientSchema = z.email();

export async function enqueueAppointmentEmail(
  tx: Prisma.TransactionClient,
  event: AppointmentEvent,
  appointment: Pick<AppointmentRecord, 'id' | 'businessId' | 'startsAt' | 'scheduleVersion'>,
) {
  const kind = emailKinds[event.type as keyof typeof emailKinds];
  if (!kind) return;
  const preference = emailPreference[kind];
  const row = await tx.appointment.findUniqueOrThrow({
    where: { id_businessId: { id: appointment.id, businessId: appointment.businessId } },
    select: {
      customer: { select: { email: true, fullName: true } },
      service: { select: { name: true } },
      business: { select: { name: true, timezone: true, [preference]: true } },
    },
  });
  if (!row.business[preference]) return;
  const recipient = recipientSchema.safeParse(row.customer.email);
  if (!recipient.success) return;
  const metadata = event.metadata as Prisma.JsonObject | null;
  await tx.reminder.createMany({
    data: [
      {
        businessId: appointment.businessId,
        appointmentId: appointment.id,
        emailKind: kind,
        deduplicationKey: `appointment-email:${event.id}`,
        scheduleVersion: appointment.scheduleVersion,
        recipient: recipient.data,
        scheduledAt: event.createdAt,
        emailData: {
          business: row.business.name,
          customer: row.customer.fullName,
          service: row.service.name,
          startsAt: appointment.startsAt.toISOString(),
          timezone: row.business.timezone,
          ...(kind === 'RESCHEDULED' &&
            typeof metadata?.previousStartsAt === 'string' && {
              previousStartsAt: metadata.previousStartsAt,
            }),
        },
      },
    ],
    skipDuplicates: true,
  });
}
