import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { buildTestApp } from '../fakes.js';

describe('plataforma', () => {
  it('/health responde sin autenticación', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('/ready devuelve 503 si la DB no responde', async () => {
    const { app } = buildTestApp({ checkReady: async () => Promise.reject(new Error('db down')) });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('db down');
  });

  it('preflight CORS válido para un origen permitido', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .options('/api/customers')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/i);
  });

  it('rechaza orígenes no permitidos con error uniforme', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('errores sin stack público y con requestId', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Ruta no encontrada', requestId: expect.any(String) },
    });
  });

  it('JSON mal formado devuelve 422', async () => {
    const { app, verifier } = buildTestApp();
    const { token } = verifier.addUser();
    const res = await request(app)
      .post('/api/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"businessName":');
    expect(res.status).toBe(422);
  });

  it('loadEnv falla sin exponer valores', () => {
    expect(() => loadEnv({ SUPABASE_URL: 'no-es-url', DATABASE_URL: 'postgres://secret' })).toThrow(
      /SUPABASE_URL/,
    );
    try {
      loadEnv({ SUPABASE_URL: 'no-es-url', DATABASE_URL: 'postgres://secret' });
    } catch (err) {
      expect((err as Error).message).not.toContain('secret');
    }
  });
});
