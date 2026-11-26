import { Router } from 'express';
import {
  createCustomerSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
  type CustomerDto,
  type Paginated,
} from '@turnosmart/shared';
import { requirePermission } from '../../middleware/auth.js';
import { AppError, notFound } from '../../lib/errors.js';
import { omitUndefined, parse, parseId } from '../../lib/http.js';
import type { CustomerRecord, CustomerRepository } from './repository.js';

const toDto = (c: CustomerRecord): CustomerDto => ({
  id: c.id,
  fullName: c.fullName,
  email: c.email,
  phone: c.phone,
  notes: c.notes,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

/** Montado detrás de authenticate + requireProfile. */
export function customersRouter(deps: { customers: CustomerRepository }): Router {
  const router = Router();

  router.get('/', requirePermission('customers:read'), async (req, res) => {
    const query = parse(listCustomersQuerySchema, req.query);
    const { items, total } = await deps.customers.list(req.auth!.businessId, query);
    const body: Paginated<CustomerDto> = {
      items: items.map(toDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
    res.json(body);
  });

  router.post('/', requirePermission('customers:write'), async (req, res) => {
    const input = parse(createCustomerSchema, req.body);
    const customer = await deps.customers.create(req.auth!.businessId, {
      fullName: input.fullName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      notes: input.notes ?? null,
    });
    res.status(201).json(toDto(customer));
  });

  router.get('/:id', requirePermission('customers:read'), async (req, res) => {
    const id = parseId(req.params.id, 'Cliente');
    const customer = await deps.customers.findById(req.auth!.businessId, id);
    if (!customer) throw notFound('Cliente');
    res.json(toDto(customer));
  });

  router.patch('/:id', requirePermission('customers:write'), async (req, res) => {
    const id = parseId(req.params.id, 'Cliente');
    const input = parse(updateCustomerSchema, req.body);
    const customer = await deps.customers.update(req.auth!.businessId, id, omitUndefined(input));
    if (!customer) throw notFound('Cliente');
    res.json(toDto(customer));
  });

  router.delete('/:id', requirePermission('customers:delete'), async (req, res) => {
    const id = parseId(req.params.id, 'Cliente');
    const result = await deps.customers.delete(req.auth!.businessId, id);
    if (result === 'not_found') throw notFound('Cliente');
    if (result === 'has_appointments') {
      throw new AppError(
        'CUSTOMER_HAS_APPOINTMENTS',
        'El cliente tiene turnos registrados y no se puede eliminar',
      );
    }
    res.status(204).end();
  });

  return router;
}
