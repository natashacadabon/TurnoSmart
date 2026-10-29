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

export const APPOINTMENT_EVENT_TYPES = [
  'CREATED',
  'RESCHEDULED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'MARKED_NO_SHOW',
] as const;
export type AppointmentEventType = (typeof APPOINTMENT_EVENT_TYPES)[number];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

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
