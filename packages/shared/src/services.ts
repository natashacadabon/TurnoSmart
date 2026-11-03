import { z } from 'zod';

/** Servicio de lectura. El backend debe proyectar estos campos explicitamente. */
export interface ServiceDto {
  /** UUID del servicio; no identifica ni autoriza el negocio del solicitante. */
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number | null;
  active: boolean;
  /** Instante UTC ISO 8601 con milisegundos y sufijo Z. */
  createdAt: string;
  /** Instante UTC ISO 8601 con milisegundos y sufijo Z. */
  updatedAt: string;
}

const serviceFields = {
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === '' ? null : v))
    .nullable(),
  durationMinutes: z.number().int().min(1).max(1440),
  priceCents: z.number().int().min(0).max(2147483647).nullable(),
  active: z.boolean(),
};

/** Solo campos editables: rechaza tenant, rol, IDs y timestamps aportados por cliente. */
export const createServiceSchema = z.strictObject({
  ...serviceFields,
  description: serviceFields.description.optional(),
  priceCents: serviceFields.priceCents.optional(),
  active: serviceFields.active.optional(),
});
export type CreateServiceRequest = z.input<typeof createServiceSchema>;

export const updateServiceSchema = createServiceSchema
  .partial()
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'Debe informar al menos un campo',
  });
export type UpdateServiceRequest = z.input<typeof updateServiceSchema>;

const queryInteger = (min: number, max: number, fallback: string) =>
  z
    .string()
    .regex(/^\d+$/)
    .default(fallback)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

/** Query HTTP cruda: arrays, booleanos y claves desconocidas no son validos. */
export const listServicesQuerySchema = z.strictObject({
  active: z.enum(['true', 'false', 'all']).default('true'),
  limit: queryInteger(1, 100, '50'),
  offset: queryInteger(0, 2147483647, '0'),
});
export type ListServicesQuery = z.output<typeof listServicesQuerySchema>;

export interface ServiceResponse {
  data: ServiceDto;
}
export interface ListServicesResponse {
  data: ServiceDto[];
  meta: ListServicesQuery & { total: number };
}
