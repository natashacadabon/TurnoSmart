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
