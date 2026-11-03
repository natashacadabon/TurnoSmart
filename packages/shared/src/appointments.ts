import { z } from 'zod';

/** Tipos acordados con C (C01). Reflejan los enums de prisma/schema.prisma. */
export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);

export const APPOINTMENT_EVENT_TYPES = [
  'CREATED',
  'RESCHEDULED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'MARKED_NO_SHOW',
] as const;
export type AppointmentEventType = (typeof APPOINTMENT_EVENT_TYPES)[number];

export const appointmentEventTypeSchema = z.enum(APPOINTMENT_EVENT_TYPES);

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const riskLevelSchema = z.enum(RISK_LEVELS);

/**
 * Turno proyectado para la API. Los instantes siempre viajan como ISO UTC.
 * `businessId` no forma parte del DTO: el tenant se resuelve desde la sesión.
 */
export interface AppointmentDto {
  id: string;
  customerId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const appointmentId = z.uuid();
const appointmentInstant = z.iso.datetime({ offset: false });

/** POST /api/appointments */
export const createAppointmentSchema = z.strictObject({
  customerId: appointmentId,
  serviceId: appointmentId,
  startsAt: appointmentInstant,
  notes: z
    .string()
    .trim()
    .max(1000)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
});
export type CreateAppointmentRequest = z.input<typeof createAppointmentSchema>;

/** PATCH /api/appointments/:id: edición de datos que no cambia el horario. */
export const updateAppointmentSchema = z
  .strictObject({
    notes: z
      .string()
      .trim()
      .max(1000)
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
  })
  .refine((value) => value.notes !== undefined, 'Debe informar al menos un campo');
export type UpdateAppointmentRequest = z.input<typeof updateAppointmentSchema>;

/** POST /api/appointments/:id/reschedule */
export const rescheduleAppointmentSchema = z.strictObject({
  startsAt: appointmentInstant,
});
export type RescheduleAppointmentRequest = z.input<typeof rescheduleAppointmentSchema>;

/** GET /api/appointments */
export const listAppointmentsQuerySchema = z
  .strictObject({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    status: appointmentStatusSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    path: ['to'],
    message: 'to debe ser igual o posterior a from',
  });
export type ListAppointmentsQuery = z.output<typeof listAppointmentsQuerySchema>;

export interface AppointmentsResponse {
  items: AppointmentDto[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Estados terminales: no se puede volver a abrir un turno completado,
 * cancelado o marcado como no-show.
 */
const TERMINAL_APPOINTMENT_STATUSES = ['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const;

export function isTerminalAppointmentStatus(status: AppointmentStatus): boolean {
  return TERMINAL_APPOINTMENT_STATUSES.includes(
    status as (typeof TERMINAL_APPOINTMENT_STATUSES)[number],
  );
}

/**
 * Máquina de estados mínima del dominio. La reprogramación no cambia el
 * estado: se mantiene SCHEDULED o CONFIRMED y se registra como evento.
 */
const APPOINTMENT_STATUS_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  CONFIRMED: ['CANCELLED', 'COMPLETED', 'NO_SHOW'],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
};

export function canTransitionAppointmentStatus(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return APPOINTMENT_STATUS_TRANSITIONS[from].includes(to);
}

export function appointmentStatusTransitions(
  from: AppointmentStatus,
): readonly AppointmentStatus[] {
  return APPOINTMENT_STATUS_TRANSITIONS[from];
}

/**
 * GET /api/appointments/:id/events (C07): orden cronológico ascendente.
 * Estados previos/nuevos y actor, si C los registra, viajan en metadata.
 */
export interface AppointmentEventDto {
  id: string;
  appointmentId: string;
  type: AppointmentEventType;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Factor observable del score (C08). Nunca contiene datos identificatorios. */
export interface RiskFactor {
  code: string;
  label: string;
  /** Aporte al score, en puntos. */
  impact: number;
  value?: string | number | boolean | null;
}

export interface RiskScoreDto {
  appointmentId: string;
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  calculatedAt: string;
}

/** Salida validada que se le exige a Gemini (A08). */
export const riskExplanationSchema = z.object({
  summary: z.string().min(1).max(800),
  recommendations: z.array(z.string().min(1).max(300)).min(1).max(4),
});
export type RiskExplanation = z.infer<typeof riskExplanationSchema>;

/** POST /api/appointments/:id/risk/explanation */
export interface RiskExplanationResponse {
  risk: RiskScoreDto;
  explanation: RiskExplanation;
  model: string;
  generatedAt: string;
  disclaimer: string;
}
