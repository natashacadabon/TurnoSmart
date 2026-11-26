import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { scheduleAppointmentReminders } from '../notifications/reminder-schedule.js';
import { appointmentFits, localTime } from '../availability/repository.js';
import type { BusinessNotificationPreferences } from '@turnosmart/shared';

export interface BusinessRecord extends BusinessNotificationPreferences {
  id: string;
  name: string;
  timezone: string;
  createdAt: Date;
}

export interface ProfileRecord {
  id: string;
  businessId: string;
  fullName: string | null;
  role: 'OWNER';
  active: boolean;
}

export interface ProfileWithBusiness {
  profile: ProfileRecord;
  business: BusinessRecord;
}

export interface PlatformAdminRecord {
  id: string;
  fullName: string | null;
  active: boolean;
}

/**
 * Acceso resuelto para un usuario de Auth. Un ADMIN global tiene prioridad: no puede operar
 * un negocio aunque, por error de datos, también tuviera un perfil OWNER.
 */
export type AccountAccess =
  | { kind: 'ADMIN'; admin: PlatformAdminRecord }
  | { kind: 'OWNER'; found: ProfileWithBusiness }
  | { kind: 'NONE'; reason: 'NO_PROFILE' | 'DISABLED' };

export interface IdentityRepository {
  /** Perfil OWNER con su negocio, activo o no. */
  findProfileWithBusiness(userId: string): Promise<ProfileWithBusiness | null>;
  findPlatformAdmin(userId: string): Promise<PlatformAdminRecord | null>;
  updateBusiness(
    businessId: string,
    data: Partial<Pick<BusinessRecord, 'name' | 'timezone'> & BusinessNotificationPreferences>,
  ): Promise<BusinessRecord>;
}

const businessSelect = {
  id: true,
  name: true,
  timezone: true,
  createdAt: true,
  bookingEmailEnabled: true,
  confirmationEmailEnabled: true,
  remindersEnabled: true,
  reminderHours: true,
  reminder24hEnabled: true,
  reminder48hEnabled: true,
  cancellationEmailEnabled: true,
  rescheduleEmailEnabled: true,
  customerCancellationEnabled: true,
  customerConfirmationEnabled: true,
  customerRescheduleEnabled: true,
  cancellationMinimumHours: true,
  rescheduleMinimumHours: true,
} as const;

/** Resuelve el acceso de una cuenta de Auth. Un ADMIN desactivado no cae a su perfil OWNER. */
export async function resolveAccess(
  identity: IdentityRepository,
  userId: string,
): Promise<AccountAccess> {
  const [admin, found] = await Promise.all([
    identity.findPlatformAdmin(userId),
    identity.findProfileWithBusiness(userId),
  ]);
  if (admin) return admin.active ? { kind: 'ADMIN', admin } : { kind: 'NONE', reason: 'DISABLED' };
  if (!found) return { kind: 'NONE', reason: 'NO_PROFILE' };
  if (!found.profile.active) return { kind: 'NONE', reason: 'DISABLED' };
  return { kind: 'OWNER', found };
}

export class PrismaIdentityRepository implements IdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findProfileWithBusiness(userId: string): Promise<ProfileWithBusiness | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      include: { business: { select: businessSelect } },
    });
    if (!profile) return null;
    const { business, ...rest } = profile;
    return {
      profile: {
        id: rest.id,
        businessId: rest.businessId,
        fullName: rest.fullName,
        role: rest.role,
        active: rest.active,
      },
      business,
    };
  }

  findPlatformAdmin(userId: string): Promise<PlatformAdminRecord | null> {
    return this.prisma.platformAdmin.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, active: true },
    });
  }

  updateBusiness(
    businessId: string,
    data: Partial<Pick<BusinessRecord, 'name' | 'timezone'> & BusinessNotificationPreferences>,
  ): Promise<BusinessRecord> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
        const reminderChange =
          data.remindersEnabled !== undefined ||
          data.reminderHours !== undefined ||
          data.reminder48hEnabled !== undefined ||
          data.reminder24hEnabled !== undefined;
        let changes = data;
        if (reminderChange) {
          const current = await tx.business.findUniqueOrThrow({
            where: { id: businessId },
            select: businessSelect,
          });
          const usesCanonical =
            data.remindersEnabled !== undefined || data.reminderHours !== undefined;
          const legacy48h = data.reminder48hEnabled ?? current.reminder48hEnabled;
          const legacy24h = data.reminder24hEnabled ?? current.reminder24hEnabled;
          const hours = usesCanonical
            ? (data.reminderHours ?? current.reminderHours)
            : [...(legacy48h ? [48] : []), ...(legacy24h ? [24] : [])];
          const enabled = usesCanonical
            ? (data.remindersEnabled ?? current.remindersEnabled)
            : legacy48h || legacy24h;
          if (enabled && hours.length === 0)
            throw new AppError(
              'VALIDATION_ERROR',
              'Configurá al menos un recordatorio o desactivá los recordatorios automáticos.',
              [{ path: 'reminderHours', message: 'Elegí al menos una anticipación.' }],
            );
          changes = {
            ...data,
            reminderHours: hours,
            remindersEnabled: enabled,
            reminder48hEnabled: enabled && hours.includes(48),
            reminder24hEnabled: enabled && hours.includes(24),
          };
        }
        if (data.timezone !== undefined) {
          const timezone = data.timezone;
          const rules = await tx.availabilityRule.findMany({ where: { businessId } });
          const appointments = await tx.appointment.findMany({
            where: {
              businessId,
              status: 'SCHEDULED',
              endsAt: { gt: new Date() },
            },
            select: { startsAt: true, endsAt: true },
          });
          const inputs = rules.map((rule) => ({
            dayOfWeek: rule.dayOfWeek,
            startTime: localTime(rule.startTime),
            endTime: localTime(rule.endTime),
            active: rule.active,
          }));
          if (appointments.some((appointment) => !appointmentFits(appointment, inputs, timezone))) {
            throw new AppError(
              'AVAILABILITY_CONFLICT',
              'La zona horaria deja turnos vigentes fuera de disponibilidad',
            );
          }
        }
        const business = await tx.business.update({
          where: { id: businessId },
          data: changes,
          select: businessSelect,
        });
        if (reminderChange) await scheduleAppointmentReminders(tx, businessId, null, new Date());
        return business;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
