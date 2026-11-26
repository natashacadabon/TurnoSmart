import { z } from 'zod';

/**
 * Roles de la plataforma.
 * - ADMIN: administrador global (tabla platform_admins). No pertenece a ningún negocio y no opera
 *   clientes, servicios, disponibilidad, agenda, turnos, riesgo ni notificaciones.
 * - OWNER: administrador operativo de un negocio (tabla profiles). Lo invita un ADMIN.
 */
export const ROLES = ['ADMIN', 'OWNER'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Matriz de permisos. Las operaciones del negocio son exclusivas de OWNER; la administración de
 * negocios y propietarios es exclusiva de ADMIN. Ningún permiso se comparte entre ambos roles.
 */
export const PERMISSIONS = {
  'business:update': ['OWNER'],
  'services:read': ['OWNER'],
  'services:write': ['OWNER'],
  'availability:read': ['OWNER'],
  'availability:write': ['OWNER'],
  'slots:read': ['OWNER'],
  'customers:read': ['OWNER'],
  'customers:write': ['OWNER'],
  'customers:delete': ['OWNER'],
  'appointments:read': ['OWNER'],
  'appointments:write': ['OWNER'],
  'risk:explain': ['OWNER'],
  // Panel de administración de la plataforma (FINAL-11).
  'platform:businesses': ['ADMIN'],
  'platform:owners': ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Contexto de un OWNER activo resuelto por el backend. El negocio nunca se toma del body. */
export interface AuthContext {
  userId: string;
  email: string | null;
  businessId: string;
  timezone: string;
  role: 'OWNER';
}

/** Contexto de un ADMIN global activo. No tiene negocio asociado. */
export interface AdminContext {
  userId: string;
  email: string | null;
  role: 'ADMIN';
}

export interface BusinessDto {
  id: string;
  name: string;
  timezone: string;
  createdAt: string;
}

export const REMINDER_HOUR_OPTIONS = [2, 6, 12, 24, 48, 72] as const;
export const reminderHoursSchema = z
  .array(
    z
      .number()
      .int()
      .refine((hours) => REMINDER_HOUR_OPTIONS.some((option) => option === hours), {
        message: 'Elegí una anticipación de 2, 6, 12, 24, 48 o 72 horas.',
      }),
  )
  .max(3, 'Podés configurar hasta tres recordatorios.')
  .refine((hours) => new Set(hours).size === hours.length, {
    message: 'Las anticipaciones de los recordatorios no pueden repetirse.',
  });

export const businessNotificationPreferencesSchema = z.strictObject({
  bookingEmailEnabled: z.boolean(),
  confirmationEmailEnabled: z.boolean(),
  remindersEnabled: z.boolean(),
  reminderHours: reminderHoursSchema,
  reminder24hEnabled: z.boolean(),
  reminder48hEnabled: z.boolean(),
  cancellationEmailEnabled: z.boolean(),
  rescheduleEmailEnabled: z.boolean(),
  customerCancellationEnabled: z.boolean(),
  customerConfirmationEnabled: z.boolean(),
  customerRescheduleEnabled: z.boolean(),
  cancellationMinimumHours: z.number().int().min(0).max(720),
  rescheduleMinimumHours: z.number().int().min(0).max(720),
});
export type BusinessNotificationPreferences = z.infer<typeof businessNotificationPreferencesSchema>;

export const updateBusinessNotificationPreferencesSchema = businessNotificationPreferencesSchema
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Debe informar al menos un campo',
  });

export interface ProfileDto {
  id: string;
  fullName: string | null;
  role: 'OWNER';
}

export interface PlatformAdminDto {
  id: string;
  fullName: string | null;
  role: 'ADMIN';
}

/** Por qué una cuenta autenticada no tiene acceso: sin perfil asignado o desactivada por un ADMIN. */
export type NoAccessReason = 'NO_PROFILE' | 'DISABLED';

/**
 * GET /api/me. `onboarded` es true sólo para un OWNER activo con negocio (las pantallas del negocio
 * dependen de eso); `access` distingue OWNER, ADMIN global y cuentas sin acceso.
 */
export type MeResponse =
  | {
      access: 'OWNER';
      onboarded: true;
      user: { id: string; email: string | null };
      profile: ProfileDto;
      business: BusinessDto;
    }
  | {
      access: 'ADMIN';
      onboarded: false;
      user: { id: string; email: string | null };
      admin: PlatformAdminDto;
    }
  | {
      access: 'NONE';
      onboarded: false;
      user: { id: string; email: string | null };
      reason: NoAccessReason;
    };

const timezone = z
  .string()
  .min(1)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Zona horaria IANA inválida' },
  );

/** PATCH /api/business */
export const updateBusinessSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    timezone: timezone.optional(),
  })
  .refine((v) => v.name !== undefined || v.timezone !== undefined, {
    message: 'Debe informar al menos un campo',
  });
export type UpdateBusinessRequest = z.input<typeof updateBusinessSchema>;
