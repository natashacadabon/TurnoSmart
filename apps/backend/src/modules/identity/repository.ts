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

/** Perfil ADMIN global: role ADMIN y business_id NULL en profiles. */
export interface PlatformAdminRecord {
  id: string;
  businessId: null;
  fullName: string | null;
  role: 'ADMIN';
  active: boolean;
}

export interface OnboardingInput {
  userId: string;
  /** Email de Supabase Auth; Profile.email es obligatorio en el schema. */
  email: string;
  businessName: string;
  timezone: string;
  fullName: string | null;
}

/**
 * Acceso resuelto para un usuario de Auth. Un perfil sólo tiene un rol: ADMIN global, OWNER de un
 * negocio o STAFF legado (sin acceso).
 */
export type AccountAccess =
  | { kind: 'ADMIN'; admin: PlatformAdminRecord }
  | { kind: 'OWNER'; found: ProfileWithBusiness }
  | { kind: 'NONE'; reason: 'NO_PROFILE' | 'DISABLED' };

export interface IdentityRepository {
  /** Perfil OWNER con su negocio, activo o no. Null para ADMIN, STAFF o sin perfil. */
  findProfileWithBusiness(userId: string): Promise<ProfileWithBusiness | null>;
  /** Perfil ADMIN global, activo o no. */
  findPlatformAdmin(userId: string): Promise<PlatformAdminRecord | null>;
  /** Existe algún perfil (incluido STAFF legado) para la cuenta. */
  hasProfile(userId: string): Promise<boolean>;
  /**
   * Alta pública: crea negocio y perfil OWNER en una transacción.
   * Devuelve `created: false` con el negocio existente si la cuenta ya era OWNER,
   * incluso si dos requests compiten (Profile.id = userId es la clave).
   */
  onboard(input: OnboardingInput): Promise<ProfileWithBusiness & { created: boolean }>;
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

/** Resuelve el acceso de una cuenta de Auth. */
export async function resolveAccess(
  identity: IdentityRepository,
  userId: string,
): Promise<AccountAccess> {
  const [admin, found] = await Promise.all([
    identity.findPlatformAdmin(userId),
    identity.findProfileWithBusiness(userId),
  ]);
  if (admin) return admin.active ? { kind: 'ADMIN', admin } : { kind: 'NONE', reason: 'DISABLED' };
  if (!found) {
    // Un perfil STAFF legado existe pero no tiene permisos: no puede hacer onboarding de nuevo.
    const legacy = await identity.hasProfile(userId);
    return { kind: 'NONE', reason: legacy ? 'DISABLED' : 'NO_PROFILE' };
  }
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
    if (!profile || profile.role !== 'OWNER' || !profile.businessId || !profile.business)
      return null;
    return {
      profile: {
        id: profile.id,
        businessId: profile.businessId,
        fullName: profile.fullName,
        role: 'OWNER',
        active: profile.active,
      },
      business: profile.business,
    };
  }

  async findPlatformAdmin(userId: string): Promise<PlatformAdminRecord | null> {
    const profile = await this.prisma.profile.findFirst({
      where: { id: userId, role: 'ADMIN', businessId: null },
      select: { id: true, fullName: true, active: true },
    });
    return profile ? { ...profile, businessId: null, role: 'ADMIN' } : null;
  }

  async hasProfile(userId: string): Promise<boolean> {
    return (await this.prisma.profile.count({ where: { id: userId } })) > 0;
  }

  async onboard(input: OnboardingInput): Promise<ProfileWithBusiness & { created: boolean }> {
    if (await this.findPlatformAdmin(input.userId)) {
      throw new AppError(
        'FORBIDDEN',
        'Las cuentas ADMIN no pueden crear un negocio desde onboarding',
      );
    }
    const existing = await this.findProfileWithBusiness(input.userId);
    if (existing) {
      if (!existing.profile.active)
        throw new AppError('ACCOUNT_DISABLED', 'La cuenta está desactivada');
      return { ...existing, created: false };
    }
    if (await this.hasProfile(input.userId))
      throw new AppError('ACCOUNT_DISABLED', 'La cuenta está desactivada');

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const business = await tx.business.create({
          data: { name: input.businessName, timezone: input.timezone },
          select: businessSelect,
        });
        const profile = await tx.profile.create({
          data: {
            id: input.userId,
            businessId: business.id,
            email: input.email,
            fullName: input.fullName,
            role: 'OWNER',
          },
          select: { id: true, fullName: true, active: true },
        });
        return {
          business,
          profile: { ...profile, businessId: business.id, role: 'OWNER' as const },
        };
      });
      return { ...result, created: true };
    } catch (err) {
      // Onboarding concurrente: otra transacción creó el perfil; ésta hizo rollback de su negocio.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findProfileWithBusiness(input.userId);
        if (winner) return { ...winner, created: false };
      }
      throw err;
    }
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
