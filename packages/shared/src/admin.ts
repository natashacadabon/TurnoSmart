import { z } from 'zod';

export interface AdminBusinessDto {
  id: string;
  name: string;
  timezone: string;
  active: boolean;
  createdAt: string;
  owner: { id: string; email: string; fullName: string | null } | null;
  owners: { id: string; email: string; fullName: string | null; active: boolean }[];
  pendingInvitations: number;
}

export interface OwnerInvitationDto {
  id: string;
  businessId: string;
  email: string;
  fullName: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  /** Sólo se devuelve al ADMIN que acaba de crear o reenviar la invitación. */
  token?: string;
}

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

export const createAdminBusinessSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  timezone: timezone.default('America/Argentina/Buenos_Aires'),
});

export const updateAdminBusinessSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    timezone: timezone.optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Debe informar al menos un campo',
  });

export const ownerInvitationSchema = z.strictObject({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(1).max(120).optional(),
});

export const updateOwnerSchema = z
  .strictObject({
    fullName: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Debe informar al menos un campo',
  });

export const acceptOwnerInvitationSchema = z.strictObject({
  token: z.string().trim().min(32).max(256),
  fullName: z.string().trim().min(1).max(120).optional(),
});
