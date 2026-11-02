import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  createServiceSchema,
  updateServiceSchema,
  listServicesQuerySchema,
} from '@turnosmart/shared';
import { PrismaServiceRepository } from '../../src/modules/services/repository.js';

const data = {
  name: 'Corte',
  description: null,
  durationMinutes: 30,
  priceCents: null,
  active: true,
};
function setup() {
  const service = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    update: vi.fn(),
  };
  const prisma = { service, $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)) };
  return { service, repo: new PrismaServiceRepository(prisma as unknown as PrismaClient) };
}
const dbError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('private constraint', { code, clientVersion: '6.12.0' });

describe('contratos de servicios', () => {
  it('normaliza trim, vacio a null y preserva precio cero', () => {
    expect(
      createServiceSchema.parse({
        name: ' Corte ',
        description: ' ',
        durationMinutes: 30,
        priceCents: 0,
      }),
    ).toEqual({ name: 'Corte', description: null, durationMinutes: 30, priceCents: 0 });
    expect(updateServiceSchema.parse({ description: null })).toEqual({ description: null });
    expect(listServicesQuerySchema.parse({})).toEqual({ active: 'true', limit: 50, offset: 0 });
  });
  it.each([
    { name: '', durationMinutes: 30 },
    { name: 'x'.repeat(121), durationMinutes: 30 },
    { ...data, description: 'x'.repeat(2001) },
    { ...data, durationMinutes: 0 },
    { ...data, durationMinutes: 1441 },
    { ...data, durationMinutes: 1.5 },
    { ...data, durationMinutes: '30' },
    { ...data, priceCents: -1 },
    { ...data, priceCents: 2147483648 },
    { ...data, active: 'true' },
    { ...data, businessId: 'injected' },
    { ...data, role: 'OWNER' },
  ])('rechaza input invalido %j', (input) =>
    expect(createServiceSchema.safeParse(input).success).toBe(false),
  );
  it('rechaza PATCH vacio, protegido y null en campos obligatorios', () => {
    for (const input of [
      {},
      { id: 'x' },
      { name: null },
      { active: null },
      { durationMinutes: null },
    ])
      expect(updateServiceSchema.safeParse(input).success).toBe(false);
  });
  it.each([
    { active: ['true', 'false'] },
    { active: true },
    { limit: '0' },
    { limit: '101' },
    { limit: '1.5' },
    { limit: '' },
    { offset: '-1' },
    { offset: '2147483648' },
    { businessId: 'x' },
  ])('rechaza query %j', (query) =>
    expect(listServicesQuerySchema.safeParse(query).success).toBe(false),
  );
});

describe('PrismaServiceRepository', () => {
  it('filtra listado y conteo por tenant/activo y aplica orden/paginacion', async () => {
    const { repo, service } = setup();
    await repo.list('tenant', { active: 'false', limit: 3, offset: 5 });
    expect(service.findMany).toHaveBeenCalledWith({
      where: { businessId: 'tenant', active: false },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: 5,
      take: 3,
    });
    expect(service.count).toHaveBeenCalledWith({ where: { businessId: 'tenant', active: false } });
    await repo.list('other', { active: 'all', limit: 50, offset: 0 });
    expect(service.count).toHaveBeenLastCalledWith({ where: { businessId: 'other' } });
  });
  it('crea con tenant del servidor y actualiza por clave compuesta', async () => {
    const { repo, service } = setup();
    await repo.create('tenant', data);
    expect(service.create).toHaveBeenCalledWith({ data: { ...data, businessId: 'tenant' } });
    await repo.update('tenant', 'id', { active: false });
    expect(service.update).toHaveBeenCalledWith({
      where: { id_businessId: { id: 'id', businessId: 'tenant' } },
      data: { active: false },
    });
  });
  it('traduce conflictos de BD tambien en PATCH y oculta inexistente/ajeno', async () => {
    const { repo, service } = setup();
    service.create.mockRejectedValue(dbError('P2002'));
    service.update.mockRejectedValue(dbError('P2002'));
    await expect(repo.create('a', data)).rejects.toMatchObject({
      code: 'SERVICE_NAME_CONFLICT',
      status: 409,
    });
    await expect(repo.update('a', 'id', data)).rejects.toMatchObject({
      code: 'SERVICE_NAME_CONFLICT',
      status: 409,
    });
    service.update.mockRejectedValue(dbError('P2025'));
    await expect(repo.update('a', 'id', data)).resolves.toBeNull();
    const error = new Error('database down');
    service.update.mockRejectedValue(error);
    await expect(repo.update('a', 'id', data)).rejects.toBe(error);
  });
});
