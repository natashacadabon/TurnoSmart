import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type Reminder } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { signActionLink, upsertActionLink } from '../appointments/action-token.js';
import { EmailDeliveryError, emailMessageSchema, type EmailProvider } from './email-provider.js';
import { emailPreference } from './email-queue.js';
import { customerActionAllowed, customerActionSelect } from '../appointments/action-policy.js';
import { appointmentEmailData, renderAppointmentEmail } from './email-templates.js';

const minute = 60_000;
const maxAttempts = 8;
const retryWindow = 23 * 60 * minute;

const businessSelect = {
  bookingEmailEnabled: true,
  confirmationEmailEnabled: true,
  cancellationEmailEnabled: true,
  rescheduleEmailEnabled: true,
  ...customerActionSelect,
  remindersEnabled: true,
  reminderHours: true,
  reminder48hEnabled: true,
  reminder24hEnabled: true,
  timezone: true,
} as const;

export class AppointmentEmailDispatcher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: EmailProvider,
    private readonly options: { from: string; actionsUrl: string; actionSecret: string },
    private readonly clock = () => new Date(),
  ) {}

  async drain(limit = 5) {
    for (let i = 0; i < limit; i++) {
      const now = this.clock();
      const [candidate] = await this.prisma.$queryRaw<{ id: string; businessId: string }[]>`
        SELECT id, business_id AS "businessId" FROM reminders
        WHERE email_kind IS NOT NULL AND status = 'PENDING' AND scheduled_at <= ${now}
          AND (lease_until IS NULL OR lease_until <= ${now})
        ORDER BY (email_kind IN ('REMINDER_48H', 'REMINDER_24H', 'REMINDER')), scheduled_at, id LIMIT 1
      `;
      if (!candidate) return;
      const claimed = await this.claim(candidate);
      if (!claimed) continue;
      const { job, message } = claimed;
      let sent: { id: string };
      try {
        sent = await this.provider.send(message, job.deduplicationKey!);
      } catch (error) {
        const now = this.clock();
        const failure =
          error instanceof EmailDeliveryError
            ? error
            : new EmailDeliveryError('EMAIL_SEND_UNCERTAIN', true);
        const next = new Date(now.getTime() + Math.min(120, 2 ** (job.attempts - 1)) * minute);
        const retry =
          failure.retryable &&
          job.attempts < maxAttempts &&
          next.getTime() - job.firstAttemptAt!.getTime() < retryWindow;
        await this.finish(job, {
          status: retry ? 'PENDING' : 'FAILED',
          ...(retry && { scheduledAt: next }),
          errorMessage: failure.code,
        });
        logger.warn('appointment_email_failed', {
          id: job.id,
          attempt: job.attempts,
          code: failure.code,
          retry,
        });
        continue;
      }
      await this.finish(job, {
        status: 'SENT',
        sentAt: this.clock(),
        providerId: sent.id,
        errorMessage: null,
      });
      logger.info('appointment_email_accepted', { id: job.id, attempt: job.attempts });
    }
  }

  private finish(job: Reminder, data: Prisma.ReminderUpdateManyMutationInput) {
    return this.prisma.reminder.updateMany({
      where: { id: job.id, businessId: job.businessId, status: 'PENDING', attempts: job.attempts },
      data: { ...data, leaseUntil: null },
    });
  }

  private claim(candidate: { id: string; businessId: string }) {
    return this.prisma.$transaction(
      async (tx) => {
        // Same lock order as booking, public actions and settings updates.
        await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${candidate.businessId}::uuid FOR UPDATE`;
        const job = await tx.reminder.findFirst({
          where: { ...candidate, status: 'PENDING' },
          include: {
            business: { select: businessSelect },
            appointment: {
              select: { status: true, startsAt: true, scheduleVersion: true, customerId: true },
            },
          },
        });
        const claimTime = this.clock();
        if (!job || job.scheduledAt > claimTime || (job.leaseUntil && job.leaseUntil > claimTime))
          return null;
        const kind = job.emailKind;
        const snapshot = appointmentEmailData.safeParse(job.emailData);
        if (!kind || !job.deduplicationKey || !job.recipient || !snapshot.success) {
          await tx.reminder.update({
            where: { id: job.id },
            data: { status: 'FAILED', errorMessage: 'INVALID_EMAIL_JOB' },
          });
          return null;
        }
        const { appointment } = job;
        const reminder = kind.startsWith('REMINDER');
        const reminderHours =
          job.reminderOffsetHours ??
          (kind === 'REMINDER_48H' ? 48 : kind === 'REMINDER_24H' ? 24 : null);
        // An email change that has committed before claim must prevent sending to the old address.
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${appointment.customerId}::uuid AND business_id = ${job.businessId}::uuid FOR SHARE`;
        const customer = await tx.customer.findUnique({
          where: { id_businessId: { id: appointment.customerId, businessId: job.businessId } },
          select: { email: true },
        });
        const now = this.clock();
        const active = appointment.status === 'SCHEDULED' && appointment.startsAt > now;
        if (
          !job.business[emailPreference[kind]] ||
          (reminder &&
            (!job.business.remindersEnabled ||
              !reminderHours ||
              !job.business.reminderHours.includes(reminderHours))) ||
          customer?.email !== job.recipient ||
          (reminder && !emailMessageSchema.shape.to.safeParse(job.recipient).success) ||
          (reminder && Date.parse(snapshot.data.startsAt) !== appointment.startsAt.getTime()) ||
          appointment.scheduleVersion !== job.scheduleVersion ||
          (kind === 'CANCELLED' ? appointment.status !== 'CANCELLED' : !active)
        ) {
          await tx.reminder.update({
            where: { id: job.id },
            data: {
              status: 'CANCELLED',
              errorMessage: 'EMAIL_NO_LONGER_APPLICABLE',
              leaseUntil: null,
            },
          });
          return null;
        }
        if (
          job.attempts >= maxAttempts ||
          (job.firstAttemptAt && now.getTime() - job.firstAttemptAt.getTime() >= retryWindow)
        ) {
          await tx.reminder.update({
            where: { id: job.id },
            data: { status: 'FAILED', errorMessage: 'EMAIL_RETRY_LIMIT', leaseUntil: null },
          });
          return null;
        }
        const links: { label: string; url: string }[] = [];
        if (kind !== 'CANCELLED') {
          const actions = [
            ['CONFIRM', 'Confirmar asistencia'] as const,
            ['CANCEL', 'Cancelar turno'] as const,
            ['REQUEST_RESCHEDULE', 'Solicitar reprogramación'] as const,
          ].filter(([action]) =>
            customerActionAllowed(action, job.business, appointment.startsAt, now),
          );
          for (const [action, label] of actions) {
            const link = await upsertActionLink(
              tx,
              {
                appointmentId: job.appointmentId,
                businessId: job.businessId,
                recipient: job.recipient,
                scheduleVersion: appointment.scheduleVersion,
                expiresAt: appointment.startsAt,
              },
              action,
            );
            const url = new URL(this.options.actionsUrl);
            url.hash = 'token=' + signActionLink(link, this.options.actionSecret);
            links.push({ label, url: url.href });
          }
        }
        const data =
          reminder && job.attempts === 0
            ? { ...snapshot.data, timezone: job.business.timezone }
            : snapshot.data;
        let content;
        try {
          content = renderAppointmentEmail(kind, data, links);
        } catch {
          await tx.reminder.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              errorMessage: 'INVALID_EMAIL_TEMPLATE_DATA',
              leaseUntil: null,
            },
          });
          return null;
        }
        const message = { from: this.options.from, to: job.recipient, ...content };
        const payloadHash = createHash('sha256')
          .update(JSON.stringify([this.provider.name, message]))
          .digest('hex');
        if (job.payloadHash && job.payloadHash !== payloadHash) {
          await tx.reminder.update({
            where: { id: job.id },
            data: { status: 'FAILED', errorMessage: 'EMAIL_PAYLOAD_CHANGED', leaseUntil: null },
          });
          return null;
        }
        const claimed = await tx.reminder.update({
          where: { id: job.id },
          data: {
            attempts: { increment: 1 },
            firstAttemptAt: job.firstAttemptAt ?? now,
            lastAttemptAt: now,
            leaseUntil: new Date(now.getTime() + minute),
            payloadHash,
            ...(reminder && job.attempts === 0 && { emailData: data }),
          },
        });
        return { job: claimed, message };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
