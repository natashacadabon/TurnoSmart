import { z } from 'zod';

/** Fecha de calendario real, sin normalizar dias inexistentes. */
export const slotsQuerySchema = z.strictObject({
  date: z.iso.date(),
  serviceId: z.uuid(),
  excludeAppointmentId: z.uuid().optional(),
});
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;
export interface SlotsResponse {
  data: SlotDto[];
}

/** Separacion entre comienzos; no impone una duracion de servicio. */
export const SLOT_INTERVAL_MINUTES = 15;

/** Intervalo disponible de lectura; no representa una reserva ni un bloqueo. */
export interface SlotDto {
  /** Instante UTC ISO 8601 con milisegundos y sufijo Z. */
  startsAt: string;
  /** Instante UTC ISO 8601 con milisegundos y sufijo Z. */
  endsAt: string;
}
