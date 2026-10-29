import { z } from 'zod';

/** Roles existentes en Profile. OWNER sólo lo asigna el backend durante el onboarding. */
export const ROLES = ['OWNER', 'ADMIN', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

/** Matriz de permisos: OWNER/ADMIN configuran y eliminan clientes; todos dan de alta y editan clientes y turnos. */
export const PERMISSIONS = {
  'business:update': ['OWNER', 'ADMIN'],
  'customers:read': ['OWNER', 'ADMIN', 'STAFF'],
  'customers:write': ['OWNER', 'ADMIN', 'STAFF'],
  // Baja definitiva: sólo quienes administran el negocio.
  'customers:delete': ['OWNER', 'ADMIN'],
  'appointments:read': ['OWNER', 'ADMIN', 'STAFF'],
  'risk:explain': ['OWNER', 'ADMIN', 'STAFF'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Contexto autenticado resuelto por el backend. El negocio nunca se toma del body. */
export interface AuthContext {
  userId: string;
  email: string | null;
  businessId: string;
  role: Role;
}

export interface BusinessDto {
  id: string;
  name: string;
  timezone: string;
  createdAt: string;
}

export interface ProfileDto {
  id: string;
  fullName: string | null;
  role: Role;
}

/** GET /api/me */
export type MeResponse =
  | {
      onboarded: true;
      user: { id: string; email: string | null };
      profile: ProfileDto;
      business: BusinessDto;
    }
  | { onboarded: false; user: { id: string; email: string | null } };

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

/** POST /api/onboarding */
export const onboardingSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  timezone: timezone.default('America/Argentina/Buenos_Aires'),
  fullName: z.string().trim().min(1).max(120).optional(),
});
export type OnboardingRequest = z.input<typeof onboardingSchema>;

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
