import { Router } from 'express';
import {
  createAppointmentSchema,
  approveRescheduleRequestSchema,
  dismissRescheduleRequestSchema,
  issueAppointmentActionSchema,
  projectAppointmentStatus,
  listAppointmentsQuerySchema,
  rescheduleAppointmentSchema,
  updateAppointmentSchema,
  type AppointmentDto,
  type AppointmentStatus,
  type AppointmentsResponse,
} from '@turnosmart/shared';
import { requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../lib/errors.js';
import { parse, parseId } from '../../lib/http.js';
import type { AppointmentRecord } from './repository.js';
import { AppointmentService } from './service.js';
import type { AppointmentActionLinks } from './action-links.js';

function toDto(row: AppointmentRecord): AppointmentDto {
  return {
    id: row.id,
    customerId: row.customerId,
    serviceId: row.serviceId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: projectAppointmentStatus(row.status, row.confirmationStatus),
    operationalStatus: row.status,
    confirmationStatus: row.confirmationStatus,
    ...(row.rescheduleRequested !== undefined && { rescheduleRequested: row.rescheduleRequested }),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const actions: Record<string, AppointmentStatus> = {
  confirm: 'CONFIRMED',
  cancel: 'CANCELLED',
  complete: 'COMPLETED',
  'no-show': 'NO_SHOW',
};

export function appointmentsRouter(deps: {
  appointments: ConstructorParameters<typeof AppointmentService>[0];
  actionLinks?: AppointmentActionLinks | undefined;
}): Router {
  const router = Router();
  const service = new AppointmentService(deps.appointments);

  router.get('/', requirePermission('appointments:read'), async (req, res) => {
    const query = parse(listAppointmentsQuerySchema, req.query);
    const result = await service.list(req.auth!.businessId, query);
    const body: AppointmentsResponse = {
      items: result.items.map(toDto),
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
    };
    res.json(body);
  });

  router.post('/', requirePermission('appointments:write'), async (req, res) => {
    const row = await service.create(
      req.auth!.businessId,
      parse(createAppointmentSchema, req.body),
      req.requestId,
    );
    res.status(201).json(toDto(row));
  });

  router.get('/:id', requirePermission('appointments:read'), async (req, res) => {
    const row = await service.findById(req.auth!.businessId, parseId(req.params.id, 'Turno'));
    if (!row) throw notFound('Turno');
    res.json(toDto(row));
  });

  router.patch('/:id', requirePermission('appointments:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Turno');
    const input = parse(updateAppointmentSchema, req.body);
    res.json(toDto(await service.updateNotes(req.auth!.businessId, id, input.notes ?? null)));
  });

  router.post('/:id/reschedule', requirePermission('appointments:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Turno');
    res.json(
      toDto(
        await service.reschedule(
          req.auth!.businessId,
          id,
          parse(rescheduleAppointmentSchema, req.body),
          undefined,
          undefined,
          req.requestId,
        ),
      ),
    );
  });

  for (const [action, status] of Object.entries(actions)) {
    router.post(`/:id/${action}`, requirePermission('appointments:write'), async (req, res) => {
      const id = parseId(req.params.id, 'Turno');
      res.json(
        toDto(
          await service.transition(
            req.auth!.businessId,
            id,
            status,
            req.auth!.userId,
            req.requestId,
          ),
        ),
      );
    });
  }

  router.post(
    '/:id/reschedule-request/approve',
    requirePermission('appointments:write'),
    async (req, res) => {
      const { businessId, userId } = req.auth!;
      const id = parseId(req.params.id, 'Turno');
      const { requestId, startsAt } = parse(approveRescheduleRequestSchema, req.body);
      res.json(
        toDto(
          await service.reschedule(
            businessId,
            id,
            { startsAt },
            requestId,
            userId,
            `reschedule-approval:${requestId}`,
          ),
        ),
      );
    },
  );

  const links = deps.actionLinks;
  if (links) {
    router.post('/:id/action-links', requirePermission('appointments:write'), async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const id = parseId(req.params.id, 'Turno');
      const { action } = parse(issueAppointmentActionSchema, req.body);
      res.json(await links.issue(req.auth!.businessId, id, action));
    });

    router.get(
      '/:id/reschedule-request',
      requirePermission('appointments:read'),
      async (req, res) => {
        const id = parseId(req.params.id, 'Turno');
        res
          .set('Cache-Control', 'no-store')
          .json(await links.getPendingRequest(req.auth!.businessId, id));
      },
    );

    router.post(
      '/:id/reschedule-request/dismiss',
      requirePermission('appointments:write'),
      async (req, res) => {
        const { businessId, userId } = req.auth!;
        const id = parseId(req.params.id, 'Turno');
        const { requestId } = parse(dismissRescheduleRequestSchema, req.body);
        await links.dismissRequest(businessId, id, requestId, userId);
        res.status(204).end();
      },
    );
  }

  return router;
}
