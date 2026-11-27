import { Router } from 'express';
import {
  acceptOwnerInvitationSchema,
  createAdminBusinessSchema,
  ownerInvitationSchema,
  updateOwnerSchema,
  updateAdminBusinessSchema,
  type AdminBusinessDto,
  type OwnerInvitationDto,
} from '@turnosmart/shared';
import { authenticate, requirePlatformAdmin, type TokenVerifier } from '../../middleware/auth.js';
import { omitUndefined, parse, parseId } from '../../lib/http.js';
import { AppError } from '../../lib/errors.js';
import type { IdentityRepository } from '../identity/repository.js';
import type { AdminBusinessRecord, AdminRepository, OwnerInvitationRecord } from './repository.js';

const toBusinessDto = (row: AdminBusinessRecord): AdminBusinessDto => ({
  id: row.id,
  name: row.name,
  timezone: row.timezone,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
  owner: row.owner,
  owners: row.owners,
  pendingInvitations: row.pendingInvitations,
});

const toInvitationDto = (row: OwnerInvitationRecord): OwnerInvitationDto => ({
  id: row.id,
  businessId: row.businessId,
  email: row.email,
  fullName: row.fullName,
  status: row.status,
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  ...(row.token ? { token: row.token } : {}),
});

export function adminRouter(deps: {
  verifier: TokenVerifier;
  identity: IdentityRepository;
  admin: AdminRepository;
}): Router {
  const router = Router();
  const auth = authenticate(deps.verifier);
  const admin = [auth, requirePlatformAdmin(deps.identity)];

  // La aceptación es la única operación de este módulo disponible para una
  // cuenta autenticada sin perfil: convierte una invitación válida en OWNER.
  router.post('/owner-invitations/accept', auth, async (req, res) => {
    const input = parse(acceptOwnerInvitationSchema, req.body);
    if (!req.user!.email)
      throw new AppError('VALIDATION_ERROR', 'La cuenta de Auth no tiene email');
    const result = await deps.admin.acceptInvitation({
      userId: req.user!.id,
      email: req.user!.email,
      token: input.token,
      fullName: input.fullName ?? null,
    });
    res.status(201).json({
      onboarded: true,
      platformAdmin: false,
      accountDisabled: false,
      user: req.user!,
      profile: { id: result.profileId, fullName: result.fullName, role: 'OWNER' },
      business: {
        id: result.businessId,
        name: result.businessName,
        timezone: result.timezone,
        createdAt: result.businessCreatedAt.toISOString(),
      },
    });
  });

  router.get('/businesses', ...admin, async (_req, res) => {
    res.json((await deps.admin.listBusinesses()).map(toBusinessDto));
  });

  router.post('/businesses', ...admin, async (req, res) => {
    const input = parse(createAdminBusinessSchema, req.body);
    res.status(201).json(toBusinessDto(await deps.admin.createBusiness(input)));
  });

  router.patch('/businesses/:id', ...admin, async (req, res) => {
    const input = parse(updateAdminBusinessSchema, req.body);
    const business = await deps.admin.updateBusiness(
      parseId(req.params.id, 'Negocio'),
      omitUndefined(input),
    );
    res.json(toBusinessDto(business));
  });

  router.patch('/businesses/:id/owners/:ownerId', ...admin, async (req, res) => {
    const input = parse(updateOwnerSchema, req.body);
    res.json(
      await deps.admin.updateOwner(
        parseId(req.params.id, 'Negocio'),
        parseId(req.params.ownerId, 'OWNER'),
        omitUndefined(input),
      ),
    );
  });

  router.get('/businesses/:id/invitations', ...admin, async (req, res) => {
    const invitations = await deps.admin.listInvitations(parseId(req.params.id, 'Negocio'));
    res.json(invitations.map(toInvitationDto));
  });

  router.post('/businesses/:id/invitations', ...admin, async (req, res) => {
    const input = parse(ownerInvitationSchema, req.body);
    const invitation = await deps.admin.inviteOwner(parseId(req.params.id, 'Negocio'), {
      email: input.email,
      fullName: input.fullName ?? null,
    });
    res.status(201).json(toInvitationDto(invitation));
  });

  router.post('/businesses/:id/invitations/:invitationId/resend', ...admin, async (req, res) => {
    const invitation = await deps.admin.resendInvitation(
      parseId(req.params.id, 'Negocio'),
      parseId(req.params.invitationId, 'Invitación'),
    );
    res.json(toInvitationDto(invitation));
  });

  router.delete('/businesses/:id/invitations/:invitationId', ...admin, async (req, res) => {
    await deps.admin.revokeInvitation(
      parseId(req.params.id, 'Negocio'),
      parseId(req.params.invitationId, 'Invitación'),
    );
    res.sendStatus(204);
  });

  return router;
}
