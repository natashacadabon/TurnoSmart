import { Prisma, type PrismaClient } from '@prisma/client';

export interface CustomerRecord {
  id: string;
  businessId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerData {
  fullName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface ListQuery {
  search?: string | undefined;
  page: number;
  pageSize: number;
}

/** Toda operación recibe businessId: no existe acceso a clientes sin tenant. */
export interface CustomerRepository {
  list(businessId: string, query: ListQuery): Promise<{ items: CustomerRecord[]; total: number }>;
  findById(businessId: string, id: string): Promise<CustomerRecord | null>;
  create(businessId: string, data: CustomerData): Promise<CustomerRecord>;
  update(
    businessId: string,
    id: string,
    data: Partial<CustomerData>,
  ): Promise<CustomerRecord | null>;
  /**
   * Baja definitiva. Un cliente con turnos no se borra: los turnos lo referencian
   * (FK con onDelete: Restrict) y conservan el historial y el riesgo.
   */
  delete(businessId: string, id: string): Promise<DeleteResult>;
}

export type DeleteResult = 'deleted' | 'not_found' | 'has_appointments';

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(businessId: string, { search, page, pageSize }: ListQuery) {
    const where = {
      businessId,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, total };
  }

  findById(businessId: string, id: string) {
    return this.prisma.customer.findFirst({ where: { id, businessId } });
  }

  create(businessId: string, data: CustomerData) {
    return this.prisma.customer.create({ data: { ...data, businessId } });
  }

  async update(businessId: string, id: string, data: Partial<CustomerData>) {
    const { count } = await this.prisma.customer.updateMany({ where: { id, businessId }, data });
    if (count === 0) return null;
    return this.findById(businessId, id);
  }

  async delete(businessId: string, id: string): Promise<DeleteResult> {
    const appointments = await this.prisma.appointment.count({
      where: { customerId: id, businessId },
    });
    if (appointments > 0) return 'has_appointments';
    try {
      const { count } = await this.prisma.customer.deleteMany({ where: { id, businessId } });
      return count === 0 ? 'not_found' : 'deleted';
    } catch (err) {
      // Un turno creado entre el conteo y el borrado: la FK lo rechaza.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        return 'has_appointments';
      }
      throw err;
    }
  }
}
