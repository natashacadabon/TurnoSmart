/** Regla semanal de lectura; las horas corresponden a la zona IANA del negocio. */
export interface AvailabilityRuleDto {
  id: string;
  /** Dia de la semana: 0 domingo, 6 sabado. Requiere validacion en ejecucion. */
  dayOfWeek: number;
  /** Hora local HH:mm, sin fecha, offset ni conversion a UTC. */
  startTime: string;
  /** Hora local HH:mm, sin fecha, offset ni conversion a UTC. */
  endTime: string;
  active: boolean;
  /** Instante UTC ISO 8601 con milisegundos y sufijo Z. */
  createdAt: string;
  /** Instante UTC ISO 8601 con milisegundos y sufijo Z. */
  updatedAt: string;
}
