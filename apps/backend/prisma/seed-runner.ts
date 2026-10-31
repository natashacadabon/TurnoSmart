import { AppointmentEventType, Prisma, type PrismaClient } from '@prisma/client';
import { assertNoActiveOverlaps, seedId, validateSeedData, type SeedData } from './seed-data.js';
import { SeedError, seedFailure, type SeedStage } from './seed-diagnostics.js';

export type SeedProfile = SeedData['accounts'][number] & { id: string };

/** Solo escribe registros reservados de este seed. Auth se crea fuera de esta transaccion. */
export async function seedDomain(prisma: PrismaClient, data: SeedData, profiles: SeedProfile[]) {
  let stage: SeedStage = 'fixtures';
  try {
    validateSeedData(data);
    stage = 'transaction_begin';
    return await prisma.$transaction(
      async (tx) => {
        const details = {
          events: [] as string[],
          risks: [] as string[],
          reminders: [] as string[],
        };
        // No mover una cuenta real ni promover un perfil que ya pertenece a otro contexto.
        stage = 'profiles';
        for (const profile of profiles) {
          const existing = await tx.profile.findUnique({ where: { id: profile.id } });
          if (
            existing &&
            (existing.businessId !== profile.businessId ||
              existing.role !== profile.role ||
              existing.email !== profile.email)
          ) {
            throw new SeedError(
              'Un usuario existente tiene otro perfil/negocio/rol; seed cancelado.',
            );
          }
        }
        stage = 'businesses';
        for (const business of data.businesses) {
          const existing = await tx.business.findUnique({ where: { id: business.id } });
          if (
            existing &&
            (existing.name !== business.name || existing.timezone !== business.timezone)
          )
            throw new SeedError('Un ID reservado del seed pertenece a otro negocio/configuracion.');
          await tx.business.upsert({ where: { id: business.id }, create: business, update: {} });
        }
        stage = 'profiles';
        for (const profile of profiles) {
          await tx.profile.upsert({ where: { id: profile.id }, create: profile, update: {} });
        }
        stage = 'customers';
        for (const customer of data.customers) {
          const existing = await tx.customer.findUnique({ where: { id: customer.id } });
          if (existing && existing.businessId !== customer.businessId)
            throw new SeedError('ID de cliente ocupado por otro negocio.');
          await tx.customer.upsert({
            where: { id: customer.id },
            create: customer,
            update: customer,
          });
        }
        stage = 'services';
        for (const service of data.services) {
          const existing = await tx.service.findUnique({ where: { id: service.id } });
          if (existing && existing.businessId !== service.businessId)
            throw new SeedError('ID de servicio ocupado por otro negocio.');
          await tx.service.upsert({ where: { id: service.id }, create: service, update: service });
        }
        stage = 'availability';
        for (const rule of data.rules) {
          const existing = await tx.availabilityRule.findUnique({ where: { id: rule.id } });
          if (existing && existing.businessId !== rule.businessId)
            throw new SeedError('ID de disponibilidad ocupado por otro negocio.');
          await tx.availabilityRule.upsert({ where: { id: rule.id }, create: rule, update: rule });
        }
        for (const appointment of data.appointments) {
          stage = 'appointments';
          const existing = await tx.appointment.findUnique({ where: { id: appointment.id } });
          if (existing && existing.businessId !== appointment.businessId)
            throw new SeedError('ID de turno ocupado por otro negocio.');
          await tx.appointment.upsert({
            where: { id: appointment.id },
            create: appointment,
            update: appointment,
          });
          const business = data.businesses.findIndex((b) => b.id === appointment.businessId) + 1;
          const index =
            data.appointments
              .filter((a) => a.businessId === appointment.businessId)
              .findIndex((a) => a.id === appointment.id) + 1;
          const event = {
            id: seedId(6, business, index),
            businessId: appointment.businessId,
            appointmentId: appointment.id,
            type: {
              SCHEDULED: AppointmentEventType.CREATED,
              CONFIRMED: AppointmentEventType.CONFIRMED,
              COMPLETED: AppointmentEventType.COMPLETED,
              CANCELLED: AppointmentEventType.CANCELLED,
              NO_SHOW: AppointmentEventType.MARKED_NO_SHOW,
            }[appointment.status],
            metadata: { source: 'development-seed' },
          };
          details.events.push(event.id);
          stage = 'appointment_events';
          const oldEvent = await tx.appointmentEvent.findUnique({ where: { id: event.id } });
          if (
            oldEvent &&
            (oldEvent.businessId !== event.businessId ||
              oldEvent.appointmentId !== event.appointmentId)
          )
            throw new SeedError('ID de evento ocupado por otro turno.');
          await tx.appointmentEvent.upsert({
            where: { id: event.id },
            create: event,
            update: event,
          });
          const score = {
            id: seedId(7, business, index),
            businessId: appointment.businessId,
            appointmentId: appointment.id,
            score: index * 18,
            level:
              index < 2 ? ('LOW' as const) : index < 4 ? ('MEDIUM' as const) : ('HIGH' as const),
            factors: ['Dato ficticio de desarrollo; no es una prediccion real.'],
          };
          details.risks.push(score.id);
          stage = 'risk_scores';
          const oldScore = await tx.riskScore.findUnique({ where: { id: score.id } });
          if (
            oldScore &&
            (oldScore.businessId !== score.businessId ||
              oldScore.appointmentId !== score.appointmentId)
          )
            throw new SeedError('ID de riesgo ocupado por otro turno.');
          await tx.riskScore.upsert({ where: { id: score.id }, create: score, update: score });
          // Cancelados deliberadamente: el seed no debe enviar correos ni activar una cola.
          const reminder = {
            id: seedId(8, business, index),
            businessId: appointment.businessId,
            appointmentId: appointment.id,
            channel: 'EMAIL' as const,
            status: 'CANCELLED' as const,
            scheduledAt: new Date(appointment.startsAt.getTime() - 86400000),
          };
          details.reminders.push(reminder.id);
          stage = 'reminders';
          const oldReminder = await tx.reminder.findUnique({ where: { id: reminder.id } });
          if (
            oldReminder &&
            (oldReminder.businessId !== reminder.businessId ||
              oldReminder.appointmentId !== reminder.appointmentId)
          )
            throw new SeedError('ID de recordatorio ocupado por otro turno.');
          await tx.reminder.upsert({
            where: { id: reminder.id },
            create: reminder,
            update: reminder,
          });
        }
        // Incluye turnos agregados manualmente a estos negocios: si chocan, rollback completo.
        const scope = { businessId: { in: data.businesses.map((b) => b.id) } };
        stage = 'data_validation';
        assertNoActiveOverlaps(await tx.appointment.findMany({ where: scope }));
        const ids = (rows: { id: string }[]) => ({ id: { in: rows.map((r) => r.id) } });
        stage = 'summary';
        const counts = {
          businesses: await tx.business.count({ where: ids(data.businesses) }),
          profiles: await tx.profile.count({ where: ids(profiles) }),
          customers: await tx.customer.count({ where: ids(data.customers) }),
          services: await tx.service.count({ where: ids(data.services) }),
          availabilityRules: await tx.availabilityRule.count({ where: ids(data.rules) }),
          appointments: await tx.appointment.count({ where: ids(data.appointments) }),
          appointmentEvents: await tx.appointmentEvent.count({
            where: { id: { in: details.events } },
          }),
          riskScores: await tx.riskScore.count({ where: { id: { in: details.risks } } }),
          reminders: await tx.reminder.count({ where: { id: { in: details.reminders } } }),
        };
        stage = 'transaction_commit';
        return counts;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 },
    );
  } catch (error) {
    throw seedFailure(stage, error);
  }
}
