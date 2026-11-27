import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { scheduleAppointmentReminders } from '../notifications/reminder-schedule.js';
import { appointmentFits, localTime } from '../availability/repository.js';
import type { BusinessNotificationPreferences, Role } from '@turnosmart/shared';

export interface BusinessRecord extends BusinessNotificationPreferences {
  id: string;
  name: string;
  timezone: string;
  active: boolean;
  createdAt: Date;
}

export interface ProfileRecord {
  id: string;
  businessId: string;
  fullName: string | null;
  active: boolean;
  role: Role;
}

export interface PlatformAdminRecord {
  id: string;
  businessId: null;
  fullName: string | null;
  role: 'ADMIN';
}

export interface ProfileWithBusiness {
  profile: ProfileRecord;
  business: BusinessRecord;
}

export interface IdentityRepository {
  findProfileWithBusiness(userId: string): Promise<ProfileWithBusiness | null>;
  /** Returns an OWNER account even when its profile or business is inactive. */
  findOwnerAccount(userId: string): Promise<ProfileWithBusiness | null>;
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
  active: true,
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

export class PrismaIdentityRepository implements IdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async readOwnerAccount(userId: string): Promise<ProfileWithBusiness | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      include: { business: { select: businessSelect } },
    });
    if (!profile || profile.role !== 'OWNER' || !profile.businessId || !profile.business)
      return null;
    const { business, ...rest } = profile;
    return {
      profile: {
        id: rest.id,
        businessId: profile.businessId,
        fullName: rest.fullName,
        active: rest.active,
        role: rest.role,
      },
      business,
    };
  }

  async findOwnerAccount(userId: string): Promise<ProfileWithBusiness | null> {
    return this.readOwnerAccount(userId);
  }

  async findProfileWithBusiness(userId: string): Promise<ProfileWithBusiness | null> {
    const found = await this.readOwnerAccount(userId);
    if (!found || !found.profile.active || !found.business.active) return null;
    return found;
  }

  async findPlatformAdmin(userId: string): Promise<PlatformAdminRecord | null> {
    const profile = await this.prisma.profile.findFirst({
      where: { id: userId, role: 'ADMIN', businessId: null },
      select: { id: true, fullName: true, role: true },
    });
    if (!profile) return null;
    return { ...profile, businessId: null, role: 'ADMIN' };
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
