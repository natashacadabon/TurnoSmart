import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { vercelPreviewCors } from '../../src/lib/vercel-preview-cors.js';
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

  it('CORS admite el origen Vercel exacto y Authorization para la API Azure', async () => {
    const origin = 'https://turnosmart-demo.vercel.app';
    const { app } = buildTestApp({ corsOrigins: [origin] });
    const allowed = await request(app)
      .options('/api/customers')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(origin);
    expect(allowed.headers['access-control-allow-headers']).toMatch(/Authorization/i);
    for (const denied of [
      'https://other.vercel.app',
      `${origin}.attacker.invalid`,
      'http://localhost:3000',
    ])
      expect((await request(app).get('/health').set('Origin', denied)).status).toBe(403);
  });

  it('autoriza el alias de la PR y conserva la URL inmutable', async () => {
    const host = 'turnosmart-pr-1361343811-23.vercel.app';
    const deployment = {
      id: 'dpl_fixture',
      projectId: 'prj_fixture',
      url: 'turnosmart-unique-scope.vercel.app',
      readyState: 'READY',
      state: 'READY',
      target: null,
      meta: { turnosmartPullRequest: '1361343811-23' },
    };
    const fetchVercel = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe('https://api.vercel.com');
      expect(url.searchParams.get('teamId')).toBe('team_fixture');
      switch (url.pathname) {
        case `/v4/aliases/${host}`:
          return Response.json({
            alias: host,
            projectId: deployment.projectId,
            deploymentId: deployment.id,
          });
        case '/v13/deployments/dpl_fixture':
          return Response.json(deployment);
        case '/v7/deployments':
          return Response.json({ deployments: [deployment] });
        default:
          throw new Error('unexpected path');
      }
    });
    const { app } = buildTestApp({
      corsPreviewOrigin: vercelPreviewCors(
        {
          projectId: deployment.projectId,
          token: 'fixture',
          teamId: 'team_fixture',
          repositoryId: '1361343811',
        },
        fetchVercel,
      ),
    });
    const preflight = (origin: string) =>
      request(app)
        .options('/api/me')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,content-type');
    for (const origin of [
      'https://turnosmart-pr-123-23.vercel.app',
      'https://turnosmart-pr-1361343811-023.vercel.app',
      'https://turnosmart-pr-1361343811-9007199254740992.vercel.app',
      `http://${host}`,
      `https://${host}.example`,
    ])
      expect((await preflight(origin)).status).toBe(403);
    expect(fetchVercel).not.toHaveBeenCalled();
    const origin = `https://${host}`;
    const responses = await Promise.all([preflight(origin), preflight(origin)]);
    for (const res of responses) {
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-headers']).toMatch(/Authorization.*Content-Type/i);
    }
    expect((await request(app).get('/api/me').set('Origin', origin)).status).toBe(401);
    expect(fetchVercel).toHaveBeenCalledTimes(2);
    expect((await preflight(`https://${deployment.url}`)).status).toBe(204);
    expect(fetchVercel).toHaveBeenCalledTimes(3);
  });

  it.each([
    'missing',
    'api-error',
    'other-project',
    'redirect',
    'production',
    'wrong-pr',
    'no-metadata',
  ])('rechaza alias sin confirmación de pertenencia: %s', async (scenario) => {
    const host = 'turnosmart-pr-1361343811-23.vercel.app';
    const fetchVercel = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        scenario === 'missing' || scenario === 'api-error'
          ? new Response(null, { status: scenario === 'missing' ? 404 : 503 })
          : Response.json({
              alias: host,
              projectId: scenario === 'other-project' ? 'prj_other' : 'prj_fixture',
              deploymentId: 'dpl_fixture',
              redirect: scenario === 'redirect' ? 'https://other.example' : null,
            }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'dpl_fixture',
          projectId: 'prj_fixture',
          readyState: 'READY',
          target: scenario === 'production' ? 'production' : null,
          meta:
            scenario === 'no-metadata'
              ? {}
              : {
                  turnosmartPullRequest:
                    scenario === 'wrong-pr' ? '1361343811-24' : '1361343811-23',
                },
        }),
      );
    const { app } = buildTestApp({
      corsPreviewOrigin: vercelPreviewCors(
        {
          projectId: 'prj_fixture',
          token: 'fixture',
          repositoryId: '1361343811',
        },
        fetchVercel,
      ),
    });
    const preflight = () =>
      request(app)
        .options('/api/me')
        .set('Origin', `https://${host}`)
        .set('Access-Control-Request-Method', 'GET');
    const res = await preflight();
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const calls = fetchVercel.mock.calls.length;
    expect((await preflight()).status).toBe(403);
    expect(fetchVercel).toHaveBeenCalledTimes(calls);
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

  it('mantiene Production estática y exige credenciales solo para Dev', () => {
    const env = {
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_ANON_KEY: 'fixture',
      DATABASE_URL: 'postgres://fixture',
      CORS_VERCEL_REPOSITORY_ID: '1361343811',
    };
    expect(loadEnv(env).CORS_ENVIRONMENT).toBe('production');
    expect(() => loadEnv({ ...env, CORS_ENVIRONMENT: 'dev' })).toThrow(/CORS_VERCEL_TOKEN/);
    expect(() => loadEnv({ ...env, CORS_VERCEL_REPOSITORY_ID: '01361343811' })).toThrow(
      /CORS_VERCEL_REPOSITORY_ID/,
    );
  });
});
