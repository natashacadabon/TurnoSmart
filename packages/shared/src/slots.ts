/** Separacion entre comienzos; no impone una duracion de servicio. */
export const SLOT_INTERVAL_MINUTES = 15;

/** Intervalo disponible de lectura; no representa una reserva ni un bloqueo. */
export interface SlotDto {
  /** Instante UTC ISO 8601 con milisegundos y sufijo Z. */
  startsAt: string;
  /** Instante UTC ISO 8601 con milisegundos y sufijo Z. */
  endsAt: string;
}
