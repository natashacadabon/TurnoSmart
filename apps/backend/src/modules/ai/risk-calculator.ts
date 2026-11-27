import type { RiskFactor, RiskLevel } from '@turnosmart/shared';
import type { CustomerAppointmentStats } from '../appointments/repository.js';

export interface RiskCalculationInput {
  startsAt: Date;
  now: Date;
  history: CustomerAppointmentStats;
  /** El cliente ya confirmó su asistencia (enlace del correo o confirmación del negocio). */
  confirmed?: boolean;
}

export interface RiskCalculation {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

/**
 * Score determinístico y auditable. No utiliza nombres, notas ni datos de contacto.
 * Los pesos son deliberadamente simples para que puedan ajustarse cuando existan
 * datos reales suficientes para calibrarlos.
 */
export function calculateNoShowRisk(input: RiskCalculationInput): RiskCalculation {
  const factors: RiskFactor[] = [];
  const { history } = input;

  if (history.noShows > 0) {
    const rate = history.noShows / Math.max(history.total, 1);
    factors.push({
      code: 'NO_SHOW_HISTORY',
      label: 'Antecedentes de inasistencia',
      impact: Math.min(50, Math.round(rate * 70)),
      value: Number(rate.toFixed(2)),
    });
  }

  if (history.cancelled > 0) {
    factors.push({
      code: 'CANCELLATION_HISTORY',
      label: 'Cancelaciones anteriores',
      impact: Math.min(20, history.cancelled * 5),
      value: history.cancelled,
    });
  }

  const leadHours = (input.startsAt.getTime() - input.now.getTime()) / 3_600_000;
  if (leadHours < 24) {
    factors.push({
      code: 'SHORT_NOTICE',
      label: 'Reserva con poca anticipación',
      impact: 15,
      value: Number(Math.max(0, leadHours).toFixed(1)),
    });
  } else if (leadHours < 72) {
    factors.push({
      code: 'LIMITED_NOTICE',
      label: 'Reserva con anticipación limitada',
      impact: 8,
      value: Number(leadHours.toFixed(1)),
    });
  }

  if (history.total === 0) {
    factors.push({
      code: 'NO_HISTORY',
      label: 'Sin historial suficiente',
      impact: 10,
      value: true,
    });
  }

  if (input.confirmed) factors.push(confirmationFactor());

  return scoreFactors(factors);
}

/** Factor que baja el riesgo cuando el cliente confirmó su asistencia. */
export const CONFIRMATION_IMPACT = -25;
function confirmationFactor(): RiskFactor {
  return {
    code: 'CUSTOMER_CONFIRMED',
    label: 'El cliente confirmó su asistencia',
    impact: CONFIRMATION_IMPACT,
    value: true,
  };
}

/** Suma los impactos (acotada a 0–100) y deriva el nivel. */
export function scoreFactors(factors: RiskFactor[]): RiskCalculation {
  const total = factors.reduce((sum, factor) => sum + factor.impact, 0);
  const score = Math.max(0, Math.min(100, total));
  const level: RiskLevel = score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';
  return { score, level, factors };
}

/**
 * Aplica la confirmación sobre un score ya calculado sin recalcular los demás factores: la
 * anticipación se mide al reservar y no debe cambiar porque el cliente confirme más tarde.
 */
export function withCustomerConfirmation(factors: RiskFactor[]): RiskCalculation {
  return scoreFactors([
    ...factors.filter((factor) => factor.code !== 'CUSTOMER_CONFIRMED'),
    confirmationFactor(),
  ]);
}
