import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/errors.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AdminBusinessRecord {
  id: string;
  name: string;
  timezone: string;
  active: boolean;
  createdAt: Date;
  owner: { id: string; email: string; fullName: string | null } | null;
  owners: { id: string; email: string; fullName: string | null; active: boolean }[];
  pendingInvitations: number;
}

export interface OwnerInvitationRecord {
  id: string;
  businessId: string;
  email: string;
  fullName: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: Date;
  createdAt: Date;
  token?: string;
}

export interface AdminRepository {
  listBusinesses(): Promise<AdminBusinessRecord[]>;
  createBusiness(input: { name: string; timezone: string }): Promise<AdminBusinessRecord>;
  updateBusiness(
    businessId: string,
    input: { name?: string; timezone?: string; active?: boolean },
  ): Promise<AdminBusinessRecord>;
  updateOwner(
    businessId: string,
    ownerId: string,
    input: { fullName?: string; active?: boolean },
  ): Promise<{ id: string; email: string; fullName: string | null; active: boolean }>;
  listInvitations(businessId: string): Promise<OwnerInvitationRecord[]>;
  inviteOwner(
    businessId: string,
    input: { email: string; fullName: string | null },
  ): Promise<OwnerInvitationRecord>;
  resendInvitation(businessId: string, invitationId: string): Promise<OwnerInvitationRecord>;
  revokeInvitation(businessId: string, invitationId: string): Promise<void>;
  acceptInvitation(input: {
    userId: string;
    email: string;
    token: string;
    fullName: string | null;
  }): Promise<{
    businessId: string;
    businessName: string;
    timezone: string;
    businessCreatedAt: Date;
    profileId: string;
    fullName: string | null;
  }>;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const normalizeEmail = (email: string) => email.trim().toLowerCase();

const businessSelect = {
  id: true,
  name: true,
  timezone: true,
  active: true,
  createdAt: true,
  profiles: {
    where: { role: 'OWNER' as const },
    select: { id: true, email: true, fullName: true, active: true },
  },
  _count: { select: { ownerInvitations: { where: { status: 'PENDING' as const } } } },
} as const;

function toBusiness(row: {
  id: string;
  name: string;
  timezone: string;
  active: boolean;
  createdAt: Date;
  profiles: { id: string; email: string; fullName: string | null; active: boolean }[];
  _count: { ownerInvitations: number };
}): AdminBusinessRecord {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    active: row.active,
    createdAt: row.createdAt,
    owner: row.profiles[0]
      ? { id: row.profiles[0].id, email: row.profiles[0].email, fullName: row.profiles[0].fullName }
      : null,
    owners: row.profiles,
    pendingInvitations: row._count.ownerInvitations,
  };
}

function toInvitation(
  row: {
    id: string;
    businessId: string;
    email: string;
    fullName: string | null;
    status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
    expiresAt: Date;
    createdAt: Date;
  },
  token?: string,
): OwnerInvitationRecord {
  return { ...row, ...(token ? { token } : {}) };
}

export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async getBusiness(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: businessSelect,
    });
    if (!business) throw new AppError('NOT_FOUND', 'Negocio no encontrado');
    return business;
  }

  async listBusinesses() {
    const rows = await this.prisma.business.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: businessSelect,
    });
    return rows.map(toBusiness);
  }

  async createBusiness(input: { name: string; timezone: string }) {
    const row = await this.prisma.business.create({
      data: { name: input.name, timezone: input.timezone },
      select: businessSelect,
    });
    return toBusiness(row);
  }

  async updateBusiness(
    businessId: string,
    input: { name?: string; timezone?: string; active?: boolean },
  ) {
    await this.getBusiness(businessId);
    const row = await this.prisma.business.update({
      where: { id: businessId },
      data: input,
      select: businessSelect,
    });
    return toBusiness(row);
  }

  async updateOwner(
    businessId: string,
    ownerId: string,
    input: { fullName?: string; active?: boolean },
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        // Serializa los cambios de estado de OWNERS por negocio. Sin este lock,
        // dos desactivaciones simultáneas podrían dejar cero OWNERS activos.
        await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
        const owner = await tx.profile.findFirst({
          where: { id: ownerId, businessId, role: 'OWNER' },
          select: { id: true, email: true, fullName: true, active: true },
        });
        if (!owner) throw new AppError('NOT_FOUND', 'OWNER no encontrado');
        if (input.active === false && owner.active) {
          const activeOwners = await tx.profile.count({
            where: { businessId, role: 'OWNER', active: true },
          });
          if (activeOwners <= 1)
            throw new AppError('CONFLICT', 'No se puede desactivar el último OWNER del negocio');
        }
        return tx.profile.update({
          where: { id: ownerId },
          data: input,
          select: { id: true, email: true, fullName: true, active: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listInvitations(businessId: string) {
    await this.getBusiness(businessId);
    const now = new Date();
    await this.prisma.ownerInvitation.updateMany({
      where: { businessId, status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    const rows = await this.prisma.ownerInvitation.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        businessId: true,
        email: true,
        fullName: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return rows.map((row) => toInvitation(row));
  }

  async inviteOwner(businessId: string, input: { email: string; fullName: string | null }) {
    const business = await this.getBusiness(businessId);
    if (!business.active)
      throw new AppError('CONFLICT', 'No se puede invitar en un negocio inactivo');
    const email = normalizeEmail(input.email);
    const existing = await this.prisma.profile.findFirst({
      where: { businessId, role: 'OWNER', email },
      select: { id: true },
    });
    if (existing) throw new AppError('CONFLICT', 'La cuenta ya es OWNER de este negocio');

    const token = randomBytes(32).toString('base64url');
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.ownerInvitation.updateMany({
        where: { businessId, email, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      return tx.ownerInvitation.create({
        data: {
          businessId,
          email,
          fullName: input.fullName,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
        select: {
          id: true,
          businessId: true,
          email: true,
          fullName: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    });
    return toInvitation(row, token);
  }

  async resendInvitation(businessId: string, invitationId: string) {
    const old = await this.prisma.ownerInvitation.findFirst({
      where: { id: invitationId, businessId },
      select: { email: true, fullName: true, status: true },
    });
    if (!old) throw new AppError('NOT_FOUND', 'Invitación no encontrada');
    if (old.status === 'ACCEPTED') throw new AppError('CONFLICT', 'La invitación ya fue aceptada');
    await this.prisma.ownerInvitation.update({
      where: { id: invitationId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    return this.inviteOwner(businessId, { email: old.email, fullName: old.fullName });
  }

  async revokeInvitation(businessId: string, invitationId: string) {
    const result = await this.prisma.ownerInvitation.updateMany({
      where: { id: invitationId, businessId, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (result.count === 0) throw new AppError('NOT_FOUND', 'Invitación pendiente no encontrada');
  }

  async acceptInvitation(input: {
    userId: string;
    email: string;
    token: string;
    fullName: string | null;
  }) {
    const email = normalizeEmail(input.email);
    const now = new Date();
    return this.prisma.$transaction(
      async (tx) => {
        const invitation = await tx.ownerInvitation.findUnique({
          where: { tokenHash: hashToken(input.token) },
          include: {
            business: {
              select: { id: true, name: true, timezone: true, active: true, createdAt: true },
            },
          },
        });
        if (!invitation || invitation.status !== 'PENDING')
          throw new AppError('FORBIDDEN', 'La invitación no es válida o ya no está pendiente');
        if (invitation.expiresAt <= now) {
          await tx.ownerInvitation.update({
            where: { id: invitation.id },
            data: { status: 'EXPIRED' },
          });
          throw new AppError('FORBIDDEN', 'La invitación expiró');
        }
        if (!invitation.business.active)
          throw new AppError('FORBIDDEN', 'El negocio está inactivo');
        if (invitation.email !== email)
          throw new AppError('FORBIDDEN', 'La invitación no corresponde al email de la sesión');

        const current = await tx.profile.findUnique({ where: { id: input.userId } });
        if (current) throw new AppError('CONFLICT', 'La cuenta ya tiene un rol asignado');

        const profile = await tx.profile.create({
          data: {
            id: input.userId,
            businessId: invitation.businessId,
            email,
            fullName: input.fullName ?? invitation.fullName,
            role: 'OWNER',
          },
          select: { id: true },
        });
        await tx.ownerInvitation.update({
          where: { id: invitation.id },
          data: { status: 'ACCEPTED', acceptedAt: now },
        });
        return {
          businessId: invitation.business.id,
          businessName: invitation.business.name,
          timezone: invitation.business.timezone,
          businessCreatedAt: invitation.business.createdAt,
          profileId: profile.id,
          fullName: input.fullName ?? invitation.fullName,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
