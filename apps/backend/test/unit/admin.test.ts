import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../fakes.js';

describe('panel ADMIN global', () => {
  it('crea negocios, invita OWNER y acepta la invitación', async () => {
    const ctx = buildTestApp();
    const admin = ctx.verifier.addUser();
    ctx.identity.addMember(admin.id, 'ignored-business-id', 'ADMIN');
    const adminAuth = { Authorization: `Bearer ${admin.token}` };

    const created = await request(ctx.app)
      .post('/api/admin/businesses')
      .set(adminAuth)
      .send({ name: 'Clínica Central', timezone: 'America/Argentina/Buenos_Aires' });
    expect(created.status).toBe(201);
    const businessId = created.body.id as string;

    const owner = ctx.verifier.addUser(undefined, 'owner@example.com');
    const invitation = await request(ctx.app)
      .post(`/api/admin/businesses/${businessId}/invitations`)
      .set(adminAuth)
      .send({ email: 'owner@example.com', fullName: 'Owner Central' });
    expect(invitation.status).toBe(201);
    expect(invitation.body.token).toEqual(expect.any(String));

    const accepted = await request(ctx.app)
      .post('/api/admin/owner-invitations/accept')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ token: invitation.body.token });
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({
      onboarded: true,
      platformAdmin: false,
      profile: { role: 'OWNER' },
      business: { id: businessId, name: 'Clínica Central' },
    });

    const deactivateLastOwner = await request(ctx.app)
      .patch(`/api/admin/businesses/${businessId}/owners/${accepted.body.profile.id}`)
      .set(adminAuth)
      .send({ active: false });
    expect(deactivateLastOwner.status).toBe(409);
  });

  it('bloquea el panel global para OWNER y bloquea la operación para ADMIN', async () => {
    const ctx = buildTestApp();
    const owner = ctx.verifier.addUser();
    ctx.identity.addMember(owner.id, 'owner-business', 'OWNER');
    const admin = ctx.verifier.addUser();
    ctx.identity.addMember(admin.id, 'ignored-business', 'ADMIN');

    expect(
      (
        await request(ctx.app)
          .get('/api/admin/businesses')
          .set({ Authorization: `Bearer ${owner.token}` })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(ctx.app)
          .get('/api/customers')
          .set({ Authorization: `Bearer ${admin.token}` })
      ).status,
    ).toBe(403);
  });
});
