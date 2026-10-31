import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { replaceAvailabilityRulesSchema } from '@turnosmart/shared';
import {
  appointmentFits,
  localTime,
  PrismaAvailabilityRepository,
} from '../../src/modules/availability/repository.js';

const rule = { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', active: true };
const parse = (rules: unknown[]) => replaceAvailabilityRulesSchema.safeParse({ rules });

describe('contrato semanal', () => {
  it('permite semana vacia, extremos, adyacencia, dias diferentes y default active', () => {
    expect(parse([]).success).toBe(true);
    expect(
      replaceAvailabilityRulesSchema.parse({
        rules: [{ dayOfWeek: 0, startTime: '00:00', endTime: '23:59' }],
      }).rules[0]?.active,
    ).toBe(true);
    expect(
      parse([rule, { ...rule, startTime: '12:00', endTime: '13:00' }, { ...rule, dayOfWeek: 6 }])
        .success,
    ).toBe(true);
  });
  it.each([
    { dayOfWeek: -1 },
    { dayOfWeek: 7 },
    { dayOfWeek: 1.5 },
    { dayOfWeek: '1' },
    { startTime: '9:00' },
    { startTime: '09:60' },
    { endTime: '24:00' },
    { startTime: '09:00:00' },
    { startTime: '09:00Z' },
    { startTime: ' 09:00' },
    { startTime: null },
    { endTime: '09:00' },
    { endTime: '08:00' },
    { startTime: '23:00', endTime: '01:00' },
    { active: 'true' },
    { active: null },
    { businessId: 'foreign' },
    { id: 'id' },
    { createdAt: 'x' },
    { updatedAt: 'x' },
    { timezone: 'UTC' },
  ])('rechaza regla invalida %j', (extra) =>
    expect(parse([{ ...rule, ...extra }]).success).toBe(false),
  );
  it('rechaza payload incompleto, desconocido y mas de 100 reglas', () => {
    for (const value of [
      {},
      { rules: null },
      { rules: {} },
      { rules: [], businessId: 'x' },
      { rules: [{}] },
      { rules: Array.from({ length: 101 }, () => rule) },
    ])
      expect(replaceAvailabilityRulesSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    { ...rule },
    { ...rule, active: false },
    { ...rule, startTime: '10:00', endTime: '11:00' },
    { ...rule, startTime: '08:00', endTime: '13:00' },
    { ...rule, startTime: '08:00', endTime: '10:00' },
  ])('rechaza duplicados y solapamientos en cualquier orden %j', (other) => {
    expect(parse([rule, other]).success).toBe(false);
    expect(parse([other, rule]).success).toBe(false);
  });
});

describe('horas persistidas y compatibilidad D03', () => {
  const appointment = (start = '2026-11-02T12:00:00Z', end = '2026-11-02T15:00:00Z') => ({
    startsAt: new Date(start),
    endsAt: new Date(end),
  });
  const timezone = 'America/Argentina/Buenos_Aires';
  it('conserva TIME sin conversion ni truncado de segundos', () => {
    expect(localTime(new Date('1970-01-01T09:00:00Z'))).toBe('09:00');
    for (const date of [
      new Date('1970-01-01T09:00:01Z'),
      new Date('1970-01-01T09:00:00.001Z'),
      new Date('invalid'),
    ])
      expect(() => localTime(date)).toThrow();
  });
  it('usa zona del negocio y limites inclusivos de la franja', () => {
    expect(appointmentFits(appointment(), [rule], timezone)).toBe(true);
    expect(appointmentFits(appointment(), [rule], 'UTC')).toBe(false);
    expect(appointmentFits(appointment('2026-11-02T11:59:59Z'), [rule], timezone)).toBe(false);
    expect(
      appointmentFits(appointment(undefined, '2026-11-02T15:00:00.001Z'), [rule], timezone),
    ).toBe(false);
  });
  it('requiere una unica franja activa del mismo dia', () => {
    expect(appointmentFits(appointment(), [], timezone)).toBe(false);
    expect(appointmentFits(appointment(), [{ ...rule, active: false }], timezone)).toBe(false);
    expect(appointmentFits(appointment(), [{ ...rule, dayOfWeek: 2 }], timezone)).toBe(false);
    expect(
      appointmentFits(
        appointment(),
        [
          { ...rule, endTime: '10:00' },
          { ...rule, startTime: '10:00' },
        ],
        timezone,
      ),
    ).toBe(false);
    expect(appointmentFits(appointment(undefined, '2026-11-03T01:00:00Z'), [rule], timezone)).toBe(
      false,
    );
  });
  it('no inventa conversion DST ni acepta zona invalida', () => {
    expect(() =>
      appointmentFits(
        appointment('2026-11-01T05:30:00Z', '2026-11-01T07:30:00Z'),
        [],
        'America/New_York',
      ),
    ).toThrow('D06');
    expect(() => appointmentFits(appointment(), [], 'invalid')).toThrow();
  });
});

function setup() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    business: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ timezone: 'UTC', availabilityRules: [] }),
    },
    appointment: { findMany: vi.fn().mockResolvedValue([]) },
    availabilityRule: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );
  return {
    tx,
    transaction,
    repo: new PrismaAvailabilityRepository({
      ...tx,
      $transaction: transaction,
    } as unknown as PrismaClient),
  };
}

describe('PrismaAvailabilityRepository', () => {
  it('lee reglas de un solo negocio con orden estable e inactivas', async () => {
    const { tx, repo } = setup();
    expect(await repo.list('tenant')).toEqual({ timezone: 'UTC', rules: [] });
    expect(tx.business.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'tenant' },
      select: {
        timezone: true,
        availabilityRules: {
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }, { endTime: 'asc' }, { id: 'asc' }],
        },
      },
    });
  });
  it('bloquea y reemplaza atomicamente por tenant, conservando identidad por upsert', async () => {
    const { tx, transaction, repo } = setup();
    await repo.replace('tenant', [rule]);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.calls[0]?.slice(1)).toEqual(['tenant']);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.appointment.findMany.mock.invocationCallOrder[0]!,
    );
    expect(tx.appointment.findMany).toHaveBeenCalledWith({
      where: {
        businessId: 'tenant',
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        endsAt: { gt: expect.any(Date) },
      },
      select: { startsAt: true, endsAt: true },
    });
    const tuple = {
      dayOfWeek: 1,
      startTime: new Date('1970-01-01T09:00:00Z'),
      endTime: new Date('1970-01-01T12:00:00Z'),
    };
    expect(tx.availabilityRule.deleteMany).toHaveBeenCalledWith({
      where: { businessId: 'tenant', NOT: { OR: [tuple] } },
    });
    expect(tx.availabilityRule.upsert).toHaveBeenCalledWith({
      where: { businessId_dayOfWeek_startTime_endTime: { businessId: 'tenant', ...tuple } },
      create: { businessId: 'tenant', ...tuple, active: true },
      update: { active: true },
    });
    expect(tx.availabilityRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'tenant' } }),
    );
  });
  it('semana vacia elimina solo las reglas del negocio', async () => {
    const { tx, repo } = setup();
    await repo.replace('tenant', []);
    expect(tx.availabilityRule.deleteMany).toHaveBeenCalledWith({
      where: { businessId: 'tenant' },
    });
    expect(tx.availabilityRule.upsert).not.toHaveBeenCalled();
  });
  it('conflicto aborta antes de cualquier escritura y sin modificar turnos', async () => {
    const { tx, repo } = setup();
    tx.appointment.findMany.mockResolvedValue([
      { startsAt: new Date('2026-11-02T09:00:00Z'), endsAt: new Date('2026-11-02T10:00:00Z') },
    ] as never);
    await expect(repo.replace('tenant', [])).rejects.toMatchObject({
      code: 'AVAILABILITY_CONFLICT',
      status: 409,
    });
    expect(tx.availabilityRule.deleteMany).not.toHaveBeenCalled();
    expect(tx.availabilityRule.upsert).not.toHaveBeenCalled();
  });
  it('propaga errores de escritura desde la transaccion', async () => {
    const { tx, repo } = setup();
    const error = new Error('database failed');
    tx.availabilityRule.upsert.mockRejectedValue(error);
    await expect(repo.replace('tenant', [rule])).rejects.toBe(error);
    expect(tx.availabilityRule.findMany).not.toHaveBeenCalled();
  });
});
