import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LlmError } from '../../src/modules/ai/llm.js';
import { FixedWindowRateLimiter } from '../../src/modules/ai/rate-limiter.js';
import { buildPrompt, RiskExplainer } from '../../src/modules/ai/risk-explainer.js';
import { sanitizeFactors } from '../../src/modules/ai/risk-repository.js';
import { buildTestApp, FakeLlm } from '../fakes.js';

const validJson = JSON.stringify({
  summary: 'El riesgo es medio porque el cliente tuvo ausencias previas.',
  recommendations: ['Enviar un recordatorio el día anterior.'],
});

const factors = [
  { code: 'PREVIOUS_NO_SHOWS', label: 'Ausencias previas', impact: 30, value: 2 },
  { code: 'LEAD_TIME', label: 'Reserva con mucha anticipación', impact: 15, value: 21 },
];

function setup(llm: FakeLlm | null, opts: { limit?: number; timeoutMs?: number } = {}) {
  const explainer = llm
    ? new RiskExplainer(llm, { timeoutMs: opts.timeoutMs ?? 500, maxOutputTokens: 200 })
    : null;
  const ctx = buildTestApp({
    explainer,
    aiRateLimit: { limit: opts.limit ?? 100, windowMs: 60_000 },
  });
  const businessId = randomUUID();
  const user = ctx.verifier.addUser();
  ctx.identity.addMember(user.id, businessId, 'STAFF');
  const appointmentId = ctx.appointments.addAppointment(businessId);
  ctx.appointments.risks.set(appointmentId, {
    appointmentId,
    score: 45,
    level: 'MEDIUM',
    factors,
    calculatedAt: new Date(),
  });
  return { ...ctx, businessId, appointmentId, auth: { Authorization: `Bearer ${user.token}` } };
}

const explain = (ctx: ReturnType<typeof setup>, id = ctx.appointmentId) =>
  request(ctx.app).post(`/api/appointments/${id}/risk/explanation`).set(ctx.auth);

describe('explicación de riesgo con Gemini', () => {
  it('devuelve explicación validada junto al score', async () => {
    const llm = new FakeLlm(async () => validJson);
    const ctx = setup(llm);
    const res = await explain(ctx);
    expect(res.status).toBe(200);
    expect(res.body.risk).toMatchObject({ score: 45, level: 'MEDIUM' });
    expect(res.body.explanation.recommendations).toHaveLength(1);
    expect(res.body.model).toBe('fake-model');
    expect(res.body.disclaimer).toMatch(/no es una probabilidad/);
  });

  it('no envía datos identificatorios a la IA', async () => {
    const llm = new FakeLlm(async () => validJson);
    const ctx = setup(llm);
    ctx.appointments.risks.get(ctx.appointmentId)!.factors = [
      ...factors,
      { code: 'X', label: 'Y', impact: 1, customerName: 'Ana Pérez', email: 'ana@example.com' },
    ];
    await explain(ctx);
    const sent = llm.calls[0]!.prompt + llm.calls[0]!.systemInstruction;
    expect(sent).not.toContain('Ana');
    expect(sent).not.toContain('@');
  });

  it('timeout controlado → 504, sin reintento', async () => {
    const llm = new FakeLlm(() => new Promise(() => {}));
    const ctx = setup(llm, { timeoutMs: 50 });
    const res = await explain(ctx);
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('AI_TIMEOUT');
    expect(llm.calls).toHaveLength(1);
  });

  it('cuota agotada → 429 AI_RATE_LIMITED', async () => {
    const llm = new FakeLlm(async () => {
      throw new LlmError('quota', '429');
    });
    const res = await explain(setup(llm));
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('AI_RATE_LIMITED');
  });

  it('respuesta inválida: un único reintento y luego 502', async () => {
    const llm = new FakeLlm(async () => '{"summary": ""}');
    const ctx = setup(llm);
    const res = await explain(ctx);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_RESPONSE');
    expect(llm.calls).toHaveLength(2);
  });

  it('se recupera si el reintento es válido', async () => {
    let n = 0;
    const llm = new FakeLlm(async () => (n++ === 0 ? 'no json' : validJson));
    expect((await explain(setup(llm))).status).toBe(200);
  });

  it('sin clave configurada → 503, pero el turno sigue existiendo', async () => {
    const ctx = setup(null);
    const res = await explain(ctx);
    expect(res.status).toBe(503);
    const events = await request(ctx.app)
      .get(`/api/appointments/${ctx.appointmentId}/events`)
      .set(ctx.auth);
    expect(events.status).toBe(200);
  });

  it('turno sin score → 404 RISK_NOT_AVAILABLE', async () => {
    const ctx = setup(new FakeLlm(async () => validJson));
    ctx.appointments.risks.clear();
    const res = await explain(ctx);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RISK_NOT_AVAILABLE');
  });

  it('turno de otro negocio → 404 sin llamar a la IA', async () => {
    const llm = new FakeLlm(async () => validJson);
    const ctx = setup(llm);
    const foreign = ctx.appointments.addAppointment(randomUUID());
    const res = await explain(ctx, foreign);
    expect(res.status).toBe(404);
    expect(llm.calls).toHaveLength(0);
  });

  it('límite por usuario → 429 RATE_LIMITED', async () => {
    const ctx = setup(new FakeLlm(async () => validJson), { limit: 1 });
    expect((await explain(ctx)).status).toBe(200);
    const res = await explain(ctx);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('helpers de IA', () => {
  it('sanitizeFactors descarta campos extra y valores largos', () => {
    const out = sanitizeFactors([
      { code: 'A', label: 'L', impact: 5, value: 'x'.repeat(200), notes: 'secreto' },
      { code: 1, label: 'inválido' },
      'basura',
    ]);
    expect(out).toEqual([{ code: 'A', label: 'L', impact: 5 }]);
    expect(sanitizeFactors(null)).toEqual([]);
  });

  it('buildPrompt sólo contiene score, nivel y factores', () => {
    const parsed = JSON.parse(buildPrompt({ score: 10, level: 'LOW', factors: [] }));
    expect(Object.keys(parsed).sort()).toEqual(['factors', 'level', 'score']);
  });

  it('rate limiter reinicia la ventana', () => {
    let t = 0;
    const limiter = new FixedWindowRateLimiter(1, 1000, () => t);
    expect(limiter.tryConsume('u')).toBe(true);
    expect(limiter.tryConsume('u')).toBe(false);
    t = 1000;
    expect(limiter.tryConsume('u')).toBe(true);
  });
});
