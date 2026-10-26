import type { PrismaClient } from '@prisma/client';
import type { RiskFactor, RiskLevel } from '@turnosmart/shared';

export interface RiskRecord {
  appointmentId: string;
  score: number;
  level: RiskLevel;
  factors: unknown;
  calculatedAt: Date;
}

/** Lectura del score persistido por C (C08). A no calcula ni modifica el score. */
export interface RiskRepository {
  find(
    businessId: string,
    appointmentId: string,
  ): Promise<{ appointmentExists: false } | { appointmentExists: true; risk: RiskRecord | null }>;
}

export class PrismaRiskRepository implements RiskRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(businessId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, businessId },
      select: {
        riskScore: {
          select: {
            appointmentId: true,
            score: true,
            level: true,
            factors: true,
            calculatedAt: true,
          },
        },
      },
    });
    if (!appointment) return { appointmentExists: false as const };
    return { appointmentExists: true as const, risk: appointment.riskScore };
  }
}

/**
 * Normaliza los factores guardados en JSON y descarta cualquier campo extra.
 * Sólo pasan code, label, impact y un value primitivo corto: nunca nombres, emails ni notas.
 */
export function sanitizeFactors(raw: unknown): RiskFactor[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f): RiskFactor[] => {
    if (!f || typeof f !== 'object') return [];
    const { code, label, impact, value } = f as Record<string, unknown>;
    if (typeof code !== 'string' || typeof label !== 'string' || typeof impact !== 'number')
      return [];
    const safeValue =
      typeof value === 'number' || typeof value === 'boolean' || value === null
        ? value
        : typeof value === 'string' && value.length <= 40
          ? value
          : undefined;
    return [
      {
        code: code.slice(0, 60),
        label: label.slice(0, 120),
        impact,
        ...(safeValue !== undefined ? { value: safeValue } : {}),
      },
    ];
  });
}
