import { Router } from 'express';
import {
  onboardingSchema,
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
  if (!found) return { onboarded: false, user };
  return {
    onboarded: true,
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
    const found = await deps.identity.findProfileWithBusiness(req.user!.id);
    res.json(toMe(req.user!, found));
  });

  router.post('/onboarding', auth, async (req, res) => {
    const input = parse(onboardingSchema, req.body);
    if (!req.user!.email) {
      throw new AppError('VALIDATION_ERROR', 'La cuenta de Auth no tiene email');
    }
    const result = await deps.identity.onboard({
      userId: req.user!.id,
      email: req.user!.email,
      businessName: input.businessName,
      timezone: input.timezone,
      fullName: input.fullName ?? null,
    });
    res.status(result.created ? 201 : 200).json(toMe(req.user!, result));
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
