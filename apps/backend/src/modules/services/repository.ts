import { Prisma, type PrismaClient } from '@prisma/client';
import type { ListServicesQuery } from '@turnosmart/shared';
import { AppError } from '../../lib/errors.js';

export interface ServiceData {
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number | null;
  active: boolean;
}
export interface ServiceRecord extends ServiceData {
  id: string;
  businessId: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface ServiceRepository {
  list(
    businessId: string,
    query: ListServicesQuery,
  ): Promise<{ items: ServiceRecord[]; total: number }>;
  create(businessId: string, data: ServiceData): Promise<ServiceRecord>;
  update(businessId: string, id: string, data: Partial<ServiceData>): Promise<ServiceRecord | null>;
}

function rethrowWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError(
      'SERVICE_NAME_CONFLICT',
      'Ya existe un servicio con ese nombre en el negocio',
    );
  }
  throw error;
}

/** Todas las operaciones requieren tenant, incluso si la conexion Prisma omite RLS. */
export class PrismaServiceRepository implements ServiceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(businessId: string, { active, limit, offset }: ListServicesQuery) {
    const where = { businessId, ...(active === 'all' ? {} : { active: active === 'true' }) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.service.count({ where }),
    ]);
    return { items, total };
  }

  async create(businessId: string, data: ServiceData) {
    try {
      return await this.prisma.service.create({ data: { ...data, businessId } });
    } catch (error) {
      rethrowWriteError(error);
    }
  }

  async update(businessId: string, id: string, data: Partial<ServiceData>) {
    try {
      // Clave compuesta: comprobacion de pertenencia y escritura en una sola operacion.
      // No modifica Appointment ni sus intervalos historicos.
      return await this.prisma.service.update({
        where: { id_businessId: { id, businessId } },
        data,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        return null;
      rethrowWriteError(error);
    }
  }
}
