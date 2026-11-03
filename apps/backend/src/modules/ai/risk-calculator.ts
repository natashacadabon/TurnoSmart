import type { RiskFactor, RiskLevel } from '@turnosmart/shared';
import type { CustomerAppointmentStats } from '../appointments/repository.js';

export interface RiskCalculationInput {
  startsAt: Date;
  now: Date;
  history: CustomerAppointmentStats;
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

  const score = Math.min(
    100,
    factors.reduce((total, factor) => total + factor.impact, 0),
  );
  const level: RiskLevel = score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';
  return { score, level, factors };
}
