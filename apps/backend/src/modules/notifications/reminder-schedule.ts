import type { Prisma } from '@prisma/client';

export function scheduleAppointmentReminders(
  tx: Prisma.TransactionClient,
  businessId: string,
  appointmentId: string | null,
  now: Date,
) {
  return tx.$executeRaw`
    SELECT public.schedule_appointment_email_reminders(
      ${businessId}::uuid, ${appointmentId}::uuid, ${now}::timestamptz
    )
  `;
}

export function invalidateAppointmentReminders(
  tx: Prisma.TransactionClient,
  businessId: string,
  filter:
    | { appointmentId: string }
    | { emailKind: { in: ('REMINDER' | 'REMINDER_48H' | 'REMINDER_24H')[] } },
  now: Date,
) {
  return tx.reminder.updateMany({
    where: {
      businessId,
      status: 'PENDING',
      AND: [{ emailKind: { in: ['REMINDER', 'REMINDER_48H', 'REMINDER_24H'] } }, filter],
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    data: {
      status: 'CANCELLED',
      leaseUntil: null,
      errorMessage: 'appointmentId' in filter ? 'REMINDER_OUTDATED' : 'REMINDER_DISABLED',
    },
  });
}
