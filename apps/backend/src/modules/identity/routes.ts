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
import {
  resolveAccess,
  type AccountAccess,
  type BusinessRecord,
  type IdentityRepository,
} from './repository.js';
import { renderAppointmentEmail } from '../notifications/email-templates.js';

const toBusinessDto = (b: BusinessRecord): BusinessDto => ({
  id: b.id,
  name: b.name,
  timezone: b.timezone,
  createdAt: b.createdAt.toISOString(),
});

function toMe(user: { id: string; email: string | null }, access: AccountAccess): MeResponse {
  if (access.kind === 'NONE')
    return { access: 'NONE', onboarded: false, platformAdmin: false, user, reason: access.reason };
  if (access.kind === 'ADMIN')
    return {
      access: 'ADMIN',
      onboarded: false,
      platformAdmin: true,
      user,
      profile: { id: access.admin.id, fullName: access.admin.fullName, role: 'ADMIN' },
      business: null,
    };
  const { profile, business } = access.found;
  return {
    access: 'OWNER',
    onboarded: true,
    platformAdmin: false,
    user,
    profile: { id: profile.id, fullName: profile.fullName, role: 'OWNER' },
    business: toBusinessDto(business),
  };
}

/** Negocio del OWNER ya validado por requireProfile. */
async function ownerBusiness(identity: IdentityRepository, userId: string) {
  const found = await identity.findProfileWithBusiness(userId);
  if (!found) throw new AppError('PROFILE_REQUIRED', 'La cuenta no tiene acceso asignado');
  return found.business;
}

/**
 * Identidad de la cuenta autenticada. Un negocio se crea por alta pública (onboarding de una cuenta
 * verificada sin perfil) o desde el panel del ADMIN global (FINAL-11).
 */
export function identityRouter(deps: {
  verifier: TokenVerifier;
  identity: IdentityRepository;
}): Router {
  const router = Router();
  const auth = authenticate(deps.verifier);
  const owner = requireProfile(deps.identity);

  router.get('/me', auth, async (req, res) => {
    const access = await resolveAccess(deps.identity, req.user!.id);
    res.set('Cache-Control', 'no-store').json(toMe(req.user!, access));
  });

  router.post('/onboarding', auth, async (req, res) => {
    const input = parse(onboardingSchema, req.body);
    if (!req.user!.email) {
      throw new AppError('VALIDATION_ERROR', 'La cuenta de Auth no tiene email');
    }
    // El repositorio rechaza ADMIN global (403 FORBIDDEN) y perfiles desactivados o STAFF.
    const result = await deps.identity.onboard({
      userId: req.user!.id,
      email: req.user!.email,
      businessName: input.businessName,
      timezone: input.timezone,
      fullName: input.fullName ?? null,
    });
    res.status(result.created ? 201 : 200).json(toMe(req.user!, { kind: 'OWNER', found: result }));
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

  router.get('/business/notification-preferences', auth, owner, async (req, res) => {
    const business = await ownerBusiness(deps.identity, req.user!.id);
    res
      .set('Cache-Control', 'no-store')
      .json(businessNotificationPreferencesSchema.strip().parse(business));
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

  router.get('/business/notification-preferences/preview/:kind', auth, owner, async (req, res) => {
    const kind = parse(emailPreviewKindSchema, req.params.kind);
    const business = await ownerBusiness(deps.identity, req.user!.id);
    const found = { business };
    const { name, timezone } = business;
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
