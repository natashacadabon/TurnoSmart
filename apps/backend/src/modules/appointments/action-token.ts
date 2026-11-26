import { createHmac } from 'node:crypto';
import type { AppointmentPublicAction, AppointmentPublicActionLink, Prisma } from '@prisma/client';

type LinkScope = Pick<
  AppointmentPublicActionLink,
  'appointmentId' | 'businessId' | 'scheduleVersion' | 'recipient' | 'expiresAt'
>;

export function upsertActionLink(
  tx: Prisma.TransactionClient,
  { expiresAt, ...scope }: LinkScope,
  action: AppointmentPublicAction,
) {
  const key = { ...scope, action };
  return tx.appointmentPublicActionLink.upsert({
    where: { appointmentId_businessId_scheduleVersion_action_recipient: key },
    create: { ...key, expiresAt },
    update: {},
  });
}

export function signActionLink(link: AppointmentPublicActionLink, secret: string) {
  const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(
      JSON.stringify([
        'appointment-action-v1',
        link.id,
        link.businessId,
        link.appointmentId,
        link.action,
        link.recipient,
        link.scheduleVersion,
        link.expiresAt.toISOString(),
      ]),
    )
    .digest('base64url');
  return link.id + '.' + signature;
}
