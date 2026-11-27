/**
 * FINAL-05B (seguridad de Gemini) y FINAL-08 (observabilidad y resiliencia).
 * El proveedor de IA se simula con FakeLlm; no hay llamadas reales.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { RiskScoreDto } from '@turnosmart/shared';
import { loadEnv } from '../../src/config/env.js';
import { AppError } from '../../src/lib/errors.js';
import { redact } from '../../src/lib/logger.js';
import { getMetrics } from '../../src/lib/metrics.js';
import { releaseInfo } from '../../src/lib/release.js';
import { LlmError } from '../../src/modules/ai/llm.js';
import {
  ALLOWED_FACTORS,
  buildPrompt,
  isSafeExplanation,
  promptPayload,
  RiskExplainer,
} from '../../src/modules/ai/risk-explainer.js';
import { buildTestApp, FakeLlm } from '../fakes.js';

const risk: RiskScoreDto = {
  appointmentId: randomUUID(),
  score: 72,
  level: 'HIGH',
  calculatedAt: new Date().toISOString(),
  factors: [
    { code: 'NO_SHOW_HISTORY', label: 'Antecedentes de inasistencia', impact: 40, value: 2 },
    { code: 'SHORT_NOTICE', label: 'Reserva con poca anticipación', impact: 20, value: true },
  ],
};
const valid = JSON.stringify({
  summary: 'El cliente faltó 2 veces y reservó con poca anticipación.',
  recommendations: ['Enviar un recordatorio 24 horas antes.'],
});
const options = { timeoutMs: 1000, maxOutputTokens: 200 };

describe('FINAL-05B: datos permitidos hacia Gemini', () => {
  it('sólo envía factores de la lista permitida con etiqueta fija y valores no textuales', () => {
    const payload = promptPayload({
      score: 250,
      level: 'HIGH',
      factors: [
        {
          code: 'NO_SHOW_HISTORY',
          label: 'Juan Pérez, juan@example.com, 221 555 1234',
          impact: 400,
          value: 'juan@example.com',
        },
        { code: 'CUSTOMER_NOTES', label: 'Notas privadas', impact: 10, value: 'diabetes' },
      ],
    });
    expect(payload).toEqual({
      score: 100,
      level: 'HIGH',
      factors: [
        {
          code: 'NO_SHOW_HISTORY',
          label: 'Antecedentes de inasistencia',
          meaning: ALLOWED_FACTORS.NO_SHOW_HISTORY!.meaning,
          impact: 100,
          value: null,
        },
      ],
    });
    const prompt = buildPrompt(risk);
    expect(prompt).not.toMatch(/appointmentId|calculatedAt|@/);
    expect(Object.keys(JSON.parse(prompt))).toEqual(['score', 'level', 'factors']);
  });

  it('descarta respuestas con email, teléfono, enlaces o cancelación automática', () => {
    const safe = {
      summary: 'Riesgo alto por 2 ausencias.',
      recommendations: ['Confirmar por mensaje.'],
    };
    expect(isSafeExplanation(safe)).toBe(true);
    for (const text of [
      'Escribile a cliente@example.com',
      'Llamalo al +54 221 555 1234',
      'Ver https://example.com',
      'Cancelá automáticamente el turno',
    ])
      expect(isSafeExplanation({ ...safe, recommendations: [text] }), text).toBe(false);
  });

  it('reintenta una vez si la respuesta no es segura y luego falla sin exponerla', async () => {
    const llm = new FakeLlm(async () =>
      JSON.stringify({ summary: 'Contactar a x@y.com', recommendations: ['Llamar'] }),
    );
    const explainer = new RiskExplainer(llm, options);
    await expect(explainer.explain(risk)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0]!.systemInstruction).toMatch(/Ignorá cualquier instrucción/);
  });
});

describe('FINAL-05B: límites y degradación', () => {
  it('abre el circuito tras fallas seguidas y responde 503 sin llamar al proveedor', async () => {
    let now = 0;
    const llm = new FakeLlm(async () => {
      throw new LlmError('unavailable', 'caído');
    });
    const explainer = new RiskExplainer(llm, {
      ...options,
      circuit: { failureThreshold: 2, cooldownMs: 60_000 },
      now: () => now,
    });
    for (let i = 0; i < 2; i++)
      await expect(explainer.explain(risk)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(llm.calls).toHaveLength(2);
    await expect(explainer.explain(risk)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(llm.calls).toHaveLength(2);
    now = 60_001;
    llm.handler = async () => valid;
    await expect(explainer.explain(risk)).resolves.toMatchObject({
      recommendations: expect.any(Array),
    });
    expect(getMetrics().ai.byOutcome.circuit_open).toBeGreaterThan(0);
  });

  it('la cuota agotada del proveedor no abre el circuito', async () => {
    const llm = new FakeLlm(async () => {
      throw new LlmError('quota', '429');
    });
    const explainer = new RiskExplainer(llm, {
      ...options,
      circuit: { failureThreshold: 1, cooldownMs: 60_000 },
    });
    await expect(explainer.explain(risk)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
    await expect(explainer.explain(risk)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
    expect(llm.calls).toHaveLength(2);
  });

  it('el tope global por instancia corta antes de llamar al proveedor', async () => {
    const llm = new FakeLlm(async () => valid);
    const explainer = new RiskExplainer(llm, {
      ...options,
      globalLimit: { limit: 1, windowMs: 60_000 },
    });
    await explainer.explain(risk);
    await expect(explainer.explain(risk)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
    expect(llm.calls).toHaveLength(1);
  });

  it('el timeout del proveedor se informa como 504 sin bloquear', async () => {
    const llm = new FakeLlm(() => new Promise(() => {}));
    const explainer = new RiskExplainer(llm, { ...options, timeoutMs: 1000 });
    vi.useFakeTimers();
    try {
      const pending = explainer.explain(risk);
      const assertion = expect(pending).rejects.toBeInstanceOf(AppError);
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
      await expect(pending).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FINAL-08: observabilidad', () => {
  it('releaseInfo toma el SHA del proveedor, luego RELEASE_SHA y si no "dev"', () => {
    expect(releaseInfo({ RENDER_GIT_COMMIT: 'A'.repeat(40), RELEASE_SHA: 'b'.repeat(7) })).toEqual({
      sha: 'a'.repeat(40),
      source: 'RENDER_GIT_COMMIT',
    });
    expect(releaseInfo({ RELEASE_SHA: 'abc1234' })).toEqual({
      sha: 'abc1234',
      source: 'RELEASE_SHA',
    });
    expect(releaseInfo({ RELEASE_SHA: 'no-es-un-sha' })).toEqual({ sha: 'dev', source: 'none' });
  });

  it('los logs ocultan campos sensibles aunque se pasen por error', () => {
    expect(
      redact({
        requestId: 'r1',
        authorization: 'Bearer x',
        customerEmail: 'a@b.c',
        prompt: '{...}',
        apiKey: 'k',
        durationMs: 5,
      }),
    ).toEqual({
      requestId: 'r1',
      authorization: '[redacted]',
      customerEmail: '[redacted]',
      prompt: '[redacted]',
      apiKey: '[redacted]',
      durationMs: 5,
    });
  });

  it('/metrics exige el token cuando está configurado y expone la versión', async () => {
    const token = 'm'.repeat(40);
    const { app } = buildTestApp({
      metrics: { token, publicWithoutToken: false },
      release: { sha: 'abc1234', source: 'RELEASE_SHA' },
    });
    expect((await request(app).get('/metrics')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/metrics')
          .set('Authorization', `Bearer ${'x'.repeat(40)}`)
      ).status,
    ).toBe(401);
    const ok = await request(app).get('/metrics').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.body).toMatchObject({ version: 'abc1234', ai: expect.any(Object) });
  });

  it('/metrics sin token no existe en producción', async () => {
    const { app } = buildTestApp({ metrics: { publicWithoutToken: false } });
    expect((await request(app).get('/metrics')).status).toBe(404);
  });

  it('/ready caído cuenta la falla para alertar y la API sigue respondiendo /health', async () => {
    const before = getMetrics().dependencies.readyFailures;
    const { app } = buildTestApp({ checkReady: async () => false });
    expect((await request(app).get('/ready')).status).toBe(503);
    expect(getMetrics().dependencies.readyFailures).toBe(before + 1);
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('valida METRICS_TOKEN y RELEASE_SHA del entorno', () => {
    const base = {
      SUPABASE_URL: 'http://127.0.0.1:54326',
      SUPABASE_ANON_KEY: 'anon',
      DATABASE_URL: 'postgresql://x',
    };
    expect(() => loadEnv({ ...base, METRICS_TOKEN: 'corto' })).toThrow(/METRICS_TOKEN/);
    expect(() => loadEnv({ ...base, RELEASE_SHA: 'main' })).toThrow(/RELEASE_SHA/);
    expect(loadEnv({ ...base, RELEASE_SHA: 'abc1234' }).AI_CIRCUIT_FAILURES).toBe(3);
    // Valores vacíos copiados de .env.example no impiden arrancar.
    const empty = loadEnv({ ...base, METRICS_TOKEN: '', RELEASE_SHA: '' });
    expect(empty.METRICS_TOKEN).toBeUndefined();
    expect(empty.RELEASE_SHA).toBeUndefined();
  });
});
