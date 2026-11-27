import { Router } from 'express';
import {
  businessNotificationPreferencesSchema,
  updateBusinessNotificationPreferencesSchema,
  updateBusinessSchema,
  emailPreviewKindSchema,
  type BusinessDto,
  type MeResponse,
} from '@turnosmart/shared';
import {
  authenticate,
  requirePermission,
  requireProfile,
  type TokenVerifier,
} from '../../middleware/auth.js';
import { AppError } from '../../lib/errors.js';
import { omitUndefined, parse } from '../../lib/http.js';
import type { BusinessRecord, IdentityRepository, ProfileWithBusiness } from './repository.js';
import { renderAppointmentEmail } from '../notifications/email-templates.js';

const toBusinessDto = (b: BusinessRecord): BusinessDto => ({
  id: b.id,
  name: b.name,
  timezone: b.timezone,
  createdAt: b.createdAt.toISOString(),
});

function toMe(
  user: { id: string; email: string | null },
  found: ProfileWithBusiness | null,
): MeResponse {
  if (!found) return { onboarded: false, platformAdmin: false, accountDisabled: false, user };
  return {
    onboarded: true,
    platformAdmin: false,
    accountDisabled: false,
    user,
    profile: { id: found.profile.id, fullName: found.profile.fullName, role: found.profile.role },
    business: toBusinessDto(found.business),
  };
}

export function identityRouter(deps: {
  verifier: TokenVerifier;
  identity: IdentityRepository;
}): Router {
  const router = Router();
  const auth = authenticate(deps.verifier);

  router.get('/me', auth, async (req, res) => {
    const admin = await deps.identity.findPlatformAdmin(req.user!.id);
    if (admin) {
      res.json({
        onboarded: false,
        platformAdmin: true,
        accountDisabled: false,
        user: req.user!,
        profile: { id: admin.id, fullName: admin.fullName, role: admin.role },
        business: null,
      });
      return;
    }
    const found = await deps.identity.findProfileWithBusiness(req.user!.id);
    if (!found) {
      const account = await deps.identity.findOwnerAccount(req.user!.id);
      if (account) {
        res.json({
          onboarded: false,
          platformAdmin: false,
          accountDisabled: true,
          user: req.user!,
          profile: {
            id: account.profile.id,
            fullName: account.profile.fullName,
            role: account.profile.role,
          },
          business: toBusinessDto(account.business),
        });
        return;
      }
    }
    res.json(toMe(req.user!, found));
  });

  router.post('/onboarding', auth, async (_req, _res) => {
    throw new AppError('FORBIDDEN', 'El alta de OWNER requiere una invitación emitida por ADMIN');
  });

  router.patch(
    '/business',
    auth,
    requireProfile(deps.identity),
    requirePermission('business:update'),
    async (req, res) => {
      const input = parse(updateBusinessSchema, req.body);
      const business = await deps.identity.updateBusiness(
        req.auth!.businessId,
        omitUndefined(input),
      );
      res.json(toBusinessDto(business));
    },
  );

  router.get('/business/notification-preferences', auth, async (req, res) => {
    const found = await deps.identity.findProfileWithBusiness(req.user!.id);
    if (!found) {
      throw new AppError('PROFILE_REQUIRED', 'La cuenta todavía no tiene negocio asociado');
    }
    res
      .set('Cache-Control', 'no-store')
      .json(businessNotificationPreferencesSchema.strip().parse(found.business));
  });

  router.patch(
    '/business/notification-preferences',
    auth,
    requireProfile(deps.identity),
    requirePermission('business:update'),
    async (req, res) => {
      const input = parse(updateBusinessNotificationPreferencesSchema, req.body);
      const business = await deps.identity.updateBusiness(
        req.auth!.businessId,
        omitUndefined(input),
      );
      res
        .set('Cache-Control', 'no-store')
        .json(businessNotificationPreferencesSchema.strip().parse(business));
    },
  );

  router.get('/business/notification-preferences/preview/:kind', auth, async (req, res) => {
    const kind = parse(emailPreviewKindSchema, req.params.kind);
    const found = await deps.identity.findProfileWithBusiness(req.user!.id);
    if (!found)
      throw new AppError('PROFILE_REQUIRED', 'La cuenta todavía no tiene negocio asociado');
    const { name, timezone } = found.business;
    const startsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const links =
      kind === 'CANCELLED'
        ? []
        : [
            ...(found.business.customerConfirmationEnabled &&
            (kind.startsWith('REMINDER') || kind === 'BOOKED')
              ? [{ label: 'Confirmar asistencia', url: '#vista-previa' }]
              : []),
            ...(found.business.customerCancellationEnabled
              ? [{ label: 'Cancelar turno', url: '#vista-previa' }]
              : []),
            ...(found.business.customerRescheduleEnabled
              ? [{ label: 'Solicitar reprogramación', url: '#vista-previa' }]
              : []),
          ];
    const { html, subject } = renderAppointmentEmail(
      kind,
      {
        business: name,
        timezone,
        startsAt,
        customer: 'Cliente de ejemplo',
        service: 'Consulta de ejemplo',
      },
      links,
    );
    res.set('Cache-Control', 'no-store').json({ html, subject });
  });

  return router;
}
