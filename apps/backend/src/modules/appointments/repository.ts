import { Prisma, type AppointmentStatus, type PrismaClient } from '@prisma/client';

export interface AppointmentRecord {
  id: string;
  businessId: string;
  customerId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppointmentListQuery {
  from?: Date;
  to?: Date;
  status?: AppointmentStatus;
  page: number;
  pageSize: number;
}

export interface AppointmentRepository {
  list(
    businessId: string,
    query: AppointmentListQuery,
  ): Promise<{ items: AppointmentRecord[]; total: number }>;
  findById(businessId: string, id: string): Promise<AppointmentRecord | null>;
  create(
    businessId: string,
    data: Pick<AppointmentRecord, 'customerId' | 'serviceId' | 'startsAt' | 'endsAt' | 'notes'>,
  ): Promise<AppointmentRecord>;
  updateNotes(
    businessId: string,
    id: string,
    notes: string | null,
  ): Promise<AppointmentRecord | null>;
  reschedule(
    businessId: string,
    id: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<AppointmentRecord | null>;
  updateStatus(
    businessId: string,
    id: string,
    status: AppointmentStatus,
  ): Promise<AppointmentRecord | null>;
  hasConflict(
    businessId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<boolean>;
}

const appointmentSelect = {
  id: true,
  businessId: true,
  customerId: true,
  serviceId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaAppointmentRepository implements AppointmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(businessId: string, query: AppointmentListQuery) {
    const where = {
      businessId,
      ...(query.from || query.to
        ? {
            startsAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: appointmentSelect,
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return { items, total };
  }

  findById(businessId: string, id: string) {
    return this.prisma.appointment.findUnique({
      where: { id_businessId: { id, businessId } },
      select: appointmentSelect,
    });
  }

  create(
    businessId: string,
    data: Pick<AppointmentRecord, 'customerId' | 'serviceId' | 'startsAt' | 'endsAt' | 'notes'>,
  ) {
    return this.prisma.appointment.create({
      data: { ...data, businessId },
      select: appointmentSelect,
    });
  }

  async updateNotes(businessId: string, id: string, notes: string | null) {
    const result = await this.prisma.appointment.updateMany({
      where: { id, businessId },
      data: { notes },
    });
    if (result.count === 0) return null;
    return this.findById(businessId, id);
  }

  async reschedule(businessId: string, id: string, startsAt: Date, endsAt: Date) {
    try {
      return await this.prisma.appointment.update({
        where: { id_businessId: { id, businessId } },
        data: { startsAt, endsAt },
        select: appointmentSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        return null;
      throw error;
    }
  }

  async updateStatus(businessId: string, id: string, status: AppointmentStatus) {
    try {
      return await this.prisma.appointment.update({
        where: { id_businessId: { id, businessId } },
        data: { status },
        select: appointmentSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        return null;
      throw error;
    }
  }

  async hasConflict(businessId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
    const row = await this.prisma.appointment.findFirst({
      where: {
        businessId,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  }
}
