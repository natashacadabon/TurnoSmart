/** Factor de confirmación, scores reales del seed y datos que recibe Gemini. */
import { describe, expect, it } from 'vitest';
import { buildSeedData, seedRiskScore } from '../../prisma/seed-data.js';
import {
  calculateNoShowRisk,
  CONFIRMATION_IMPACT,
  withCustomerConfirmation,
} from '../../src/modules/ai/risk-calculator.js';
import { ALLOWED_FACTORS, promptPayload } from '../../src/modules/ai/risk-explainer.js';

const now = new Date('2026-11-26T12:00:00Z');
const history = { total: 2, completed: 1, noShows: 1, cancelled: 0 };

describe('factor de confirmación', () => {
  it('baja el score cuando el cliente ya confirmó', () => {
    const startsAt = new Date(now.getTime() + 10 * 3_600_000);
    const pending = calculateNoShowRisk({ startsAt, now, history });
    const confirmed = calculateNoShowRisk({ startsAt, now, history, confirmed: true });
    expect(confirmed.score).toBe(Math.max(0, pending.score + CONFIRMATION_IMPACT));
    expect(confirmed.factors.at(-1)).toEqual({
      code: 'CUSTOMER_CONFIRMED',
      label: 'El cliente confirmó su asistencia',
      impact: CONFIRMATION_IMPACT,
      value: true,
    });
  });

  it('al confirmar conserva los demás factores y no duplica la confirmación', () => {
    const base = calculateNoShowRisk({
      startsAt: new Date(now.getTime() + 10 * 3_600_000),
      now,
      history,
    });
    const once = withCustomerConfirmation(base.factors);
    const twice = withCustomerConfirmation(once.factors);
    expect(twice).toEqual(once);
    expect(once.factors.filter((f) => f.code === 'CUSTOMER_CONFIRMED')).toHaveLength(1);
    expect(once.factors.slice(0, -1)).toEqual(base.factors);
    expect(once.level).toBe(once.score >= 60 ? 'HIGH' : once.score >= 30 ? 'MEDIUM' : 'LOW');
  });

  it('el score nunca baja de 0', () => {
    expect(withCustomerConfirmation([]).score).toBe(0);
  });
});

describe('scores del seed', () => {
  const data = buildSeedData(now);

  it('usan factores reales del calculador, nunca texto libre', () => {
    for (const appointment of data.appointments) {
      const risk = seedRiskScore(data, appointment);
      for (const factor of risk.factors)
        expect(Object.keys(ALLOWED_FACTORS)).toContain(factor.code);
      expect(risk.score).toBeGreaterThanOrEqual(0);
      expect(risk.score).toBeLessThanOrEqual(100);
    }
  });

  it('el turno futuro de un cliente que faltó tiene riesgo alto y explicable', () => {
    const appointment = data.appointments[0]!;
    const risk = seedRiskScore(data, appointment);
    expect(risk.factors.map((f) => f.code)).toEqual(
      expect.arrayContaining(['NO_SHOW_HISTORY', 'SHORT_NOTICE']),
    );
    expect(risk.level).toBe('HIGH');
  });

  it('el turno ya confirmado incluye el factor de confirmación', () => {
    const confirmed = data.appointments.find((a) => a.confirmationStatus === 'CONFIRMED')!;
    expect(seedRiskScore(data, confirmed).factors.map((f) => f.code)).toContain(
      'CUSTOMER_CONFIRMED',
    );
  });
});

describe('datos que recibe Gemini', () => {
  it('cada factor lleva su significado fijo para que la explicación cite valores concretos', () => {
    const payload = promptPayload(
      seedRiskScore(buildSeedData(now), buildSeedData(now).appointments[0]!),
    );
    for (const factor of payload.factors) {
      expect(factor.meaning).toBe(ALLOWED_FACTORS[factor.code]!.meaning);
      expect(typeof factor.value === 'number' || typeof factor.value === 'boolean').toBe(true);
    }
  });
});
