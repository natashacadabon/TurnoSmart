import { Prisma, type PrismaClient } from '@prisma/client';
import type { Role } from '@turnosmart/shared';

export interface BusinessRecord {
  id: string;
  name: string;
  timezone: string;
  createdAt: Date;
}

export interface ProfileRecord {
  id: string;
  businessId: string;
  fullName: string | null;
  role: Role;
}

export interface ProfileWithBusiness {
  profile: ProfileRecord;
  business: BusinessRecord;
}

export interface OnboardingInput {
  userId: string;
  /** Email de Supabase Auth; Profile.email es obligatorio en el schema. */
  email: string;
  businessName: string;
  timezone: string;
  fullName: string | null;
}

export interface IdentityRepository {
  findProfileWithBusiness(userId: string): Promise<ProfileWithBusiness | null>;
  /**
   * Crea negocio y perfil OWNER en una transacción.
   * Devuelve `created: false` con el negocio existente si la cuenta ya estaba asociada,
   * incluso si dos requests compiten (Profile.id = userId es la clave).
   */
  onboard(input: OnboardingInput): Promise<ProfileWithBusiness & { created: boolean }>;
  updateBusiness(
    businessId: string,
    data: { name?: string; timezone?: string },
  ): Promise<BusinessRecord>;
}

const businessSelect = { id: true, name: true, timezone: true, createdAt: true } as const;

export class PrismaIdentityRepository implements IdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findProfileWithBusiness(userId: string): Promise<ProfileWithBusiness | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      include: { business: { select: businessSelect } },
    });
    if (!profile) return null;
    const { business, ...rest } = profile;
    return {
      profile: {
        id: rest.id,
        businessId: rest.businessId,
        fullName: rest.fullName,
        role: rest.role,
      },
      business,
    };
  }

  async onboard(input: OnboardingInput): Promise<ProfileWithBusiness & { created: boolean }> {
    const existing = await this.findProfileWithBusiness(input.userId);
    if (existing) return { ...existing, created: false };

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const business = await tx.business.create({
          data: { name: input.businessName, timezone: input.timezone },
          select: businessSelect,
        });
        const profile = await tx.profile.create({
          data: {
            id: input.userId,
            businessId: business.id,
            email: input.email,
            fullName: input.fullName,
            role: 'OWNER',
          },
          select: { id: true, businessId: true, fullName: true, role: true },
        });
        return { business, profile };
      });
      return { ...result, created: true };
    } catch (err) {
      // Onboarding concurrente: otra transacción creó el perfil; ésta hizo rollback de su negocio.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findProfileWithBusiness(input.userId);
        if (winner) return { ...winner, created: false };
      }
      throw err;
    }
  }

  updateBusiness(
    businessId: string,
    data: { name?: string; timezone?: string },
  ): Promise<BusinessRecord> {
    return this.prisma.business.update({ where: { id: businessId }, data, select: businessSelect });
  }
}
