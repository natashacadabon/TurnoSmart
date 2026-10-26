import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AppointmentEventType } from '@turnosmart/shared';
import { buildTestApp } from '../fakes.js';

describe('historial de eventos', () => {
  it('orden cronológico y aislamiento por negocio', async () => {
    const ctx = buildTestApp();
    const businessId = randomUUID();
    const user = ctx.verifier.addUser();
    ctx.identity.addMember(user.id, businessId, 'STAFF');
    const auth = { Authorization: `Bearer ${user.token}` };
    const appointmentId = ctx.appointments.addAppointment(businessId);

    const base = Date.now();
    const types: AppointmentEventType[] = ['RESCHEDULED', 'CREATED'];
    for (const [i, type] of types.entries()) {
      ctx.appointments.events.push({
        id: randomUUID(),
        businessId,
        appointmentId,
        type,
        metadata: { source: 'test' },
        createdAt: new Date(base - i * 1000),
      });
    }

    const res = await request(ctx.app).get(`/api/appointments/${appointmentId}/events`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'RESCHEDULED']);
    expect(res.body[0].metadata).toEqual({ source: 'test' });

    const foreign = ctx.appointments.addAppointment(randomUUID());
    const denied = await request(ctx.app).get(`/api/appointments/${foreign}/events`).set(auth);
    expect(denied.status).toBe(404);
  });

  it('sin token responde 401', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get(`/api/appointments/${randomUUID()}/events`);
    expect(res.status).toBe(401);
  });
});
