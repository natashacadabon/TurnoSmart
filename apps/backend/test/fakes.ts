import { InMemoryServices } from './services-fakes.js';
import { InMemoryAvailability } from './availability-fakes.js';
import { InMemorySlots } from './slots-fakes.js';
import { randomUUID } from 'node:crypto';
import type { Role } from '@turnosmart/shared';
import { createApp, type AppDeps } from '../src/app.js';
import { AppError } from '../src/lib/errors.js';
import type { TokenVerifier, VerifiedUser } from '../src/middleware/auth.js';
import type { LlmClient, LlmRequest } from '../src/modules/ai/llm.js';
import type {
  RiskRecord,
  RiskRepository,
  RiskScoreInput,
} from '../src/modules/ai/risk-repository.js';
import type {
  CustomerData,
  CustomerRecord,
  CustomerRepository,
  ListQuery,
} from '../src/modules/customers/repository.js';
import type { EventRecord, EventRepository } from '../src/modules/events/repository.js';
import { InMemoryAppointmentRepository } from './appointments-fakes.js';
import type {
  BusinessRecord,
  IdentityRepository,
  ProfileRecord,
  ProfileWithBusiness,
} from '../src/modules/identity/repository.js';
import type {
  AdminBusinessRecord,
  AdminRepository,
  OwnerInvitationRecord,
} from '../src/modules/admin/repository.js';

/** Tokens de prueba: "token-<userId>". "expired" simula un token vencido. */
export class FakeVerifier implements TokenVerifier {
  readonly users = new Map<string, VerifiedUser>();

  addUser(id = randomUUID(), email: string | null = `${id.slice(0, 8)}@test.local`) {
    this.users.set(`token-${id}`, { id, email });
    return { id, token: `token-${id}` };
  }

  async verify(token: string) {
    return this.users.get(token) ?? null;
  }
}

export class InMemoryIdentity implements IdentityRepository {
  readonly businesses = new Map<string, BusinessRecord>();
  readonly profiles = new Map<string, ProfileRecord>();
  readonly platformAdmins = new Map<string, { id: string; fullName: string | null }>();
  readonly preferences = {
    bookingEmailEnabled: true,
    confirmationEmailEnabled: true,
    remindersEnabled: true,
    reminderHours: [48, 24],
    reminder24hEnabled: true,
    reminder48hEnabled: true,
    cancellationEmailEnabled: false,
    rescheduleEmailEnabled: false,
    customerCancellationEnabled: true,
    customerConfirmationEnabled: true,
    customerRescheduleEnabled: true,
    cancellationMinimumHours: 0,
    rescheduleMinimumHours: 0,
  };

  addMember(userId: string, businessId: string, role: Role) {
    if (role === 'ADMIN') {
      this.platformAdmins.set(userId, { id: userId, fullName: null });
      return;
    }
    if (!this.businesses.has(businessId)) {
      this.businesses.set(businessId, {
        ...this.preferences,
        id: businessId,
        name: 'Negocio',
        timezone: 'UTC',
        active: true,
        createdAt: new Date(),
      });
    }
    this.profiles.set(userId, { id: userId, businessId, fullName: null, active: true, role });
  }

  async findProfileWithBusiness(userId: string): Promise<ProfileWithBusiness | null> {
    const profile = this.profiles.get(userId);
    if (!profile) return null;
    const business = this.businesses.get(profile.businessId);
    if (profile.role !== 'OWNER' || !profile.active || !business?.active) return null;
    return { profile, business };
  }

  async findOwnerAccount(userId: string): Promise<ProfileWithBusiness | null> {
    const profile = this.profiles.get(userId);
    if (!profile || profile.role !== 'OWNER') return null;
    const business = this.businesses.get(profile.businessId);
    return business ? { profile, business } : null;
  }

  async findPlatformAdmin(userId: string) {
    const admin = this.platformAdmins.get(userId);
    return admin ? { ...admin, businessId: null as null, role: 'ADMIN' as const } : null;
  }

  async updateBusiness(
    businessId: string,
    data: Parameters<IdentityRepository['updateBusiness']>[1],
  ) {
    const b = { ...this.businesses.get(businessId)!, ...data };
    this.businesses.set(businessId, b);
    return b;
  }
}

export class InMemoryAdmin implements AdminRepository {
  readonly invitations = new Map<string, OwnerInvitationRecord & { token: string }>();

  constructor(private readonly identity: InMemoryIdentity) {}

  private business(id: string): AdminBusinessRecord {
    const business = this.identity.businesses.get(id);
    if (!business) throw new Error('Negocio no encontrado');
    const owner = [...this.identity.profiles.values()].find(
      (profile) => profile.businessId === id && profile.role === 'OWNER',
    );
    const pendingInvitations = [...this.invitations.values()].filter(
      (invitation) => invitation.businessId === id && invitation.status === 'PENDING',
    ).length;
    return {
      id: business.id,
      name: business.name,
      timezone: business.timezone,
      active: business.active,
      createdAt: business.createdAt,
      owner: owner
        ? { id: owner.id, email: `${owner.id}@test.local`, fullName: owner.fullName }
        : null,
      owners: owner
        ? [
            {
              id: owner.id,
              email: `${owner.id}@test.local`,
              fullName: owner.fullName,
              active: owner.active,
            },
          ]
        : [],
      pendingInvitations,
    };
  }

  async listBusinesses() {
    return [...this.identity.businesses.keys()].map((id) => this.business(id));
  }

  async createBusiness(input: { name: string; timezone: string }) {
    const id = randomUUID();
    this.identity.businesses.set(id, {
      ...this.identity['preferences'],
      id,
      name: input.name,
      timezone: input.timezone,
      active: true,
      createdAt: new Date(),
    });
    return this.business(id);
  }

  async updateBusiness(
    businessId: string,
    input: { name?: string; timezone?: string; active?: boolean },
  ) {
    const business = this.identity.businesses.get(businessId);
    if (!business) throw new Error('Negocio no encontrado');
    Object.assign(business, input);
    return this.business(businessId);
  }

  async updateOwner(
    businessId: string,
    ownerId: string,
    input: { fullName?: string; active?: boolean },
  ) {
    const owner = this.identity.profiles.get(ownerId);
    if (!owner || owner.businessId !== businessId || owner.role !== 'OWNER')
      throw new AppError('NOT_FOUND', 'OWNER no encontrado');
    const activeOwners = [...this.identity.profiles.values()].filter(
      (profile) => profile.businessId === businessId && profile.role === 'OWNER' && profile.active,
    ).length;
    if (input.active === false && owner.active && activeOwners <= 1)
      throw new AppError('CONFLICT', 'No se puede desactivar el último OWNER');
    Object.assign(owner, input);
    return {
      id: owner.id,
      email: `${owner.id}@test.local`,
      fullName: owner.fullName,
      active: owner.active,
    };
  }

  async listInvitations(businessId: string) {
    return [...this.invitations.values()]
      .filter((invitation) => invitation.businessId === businessId)
      .map(({ token: _token, ...invitation }) => invitation);
  }

  async inviteOwner(businessId: string, input: { email: string; fullName: string | null }) {
    const token = `${randomUUID()}${randomUUID()}`;
    const invitation: OwnerInvitationRecord & { token: string } = {
      id: randomUUID(),
      businessId,
      email: input.email.toLowerCase(),
      fullName: input.fullName,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      createdAt: new Date(),
      token,
    };
    this.invitations.set(invitation.id, invitation);
    return invitation;
  }

  async resendInvitation(businessId: string, invitationId: string) {
    const old = this.invitations.get(invitationId);
    if (!old || old.businessId !== businessId) throw new Error('Invitación no encontrada');
    old.status = 'REVOKED';
    return this.inviteOwner(businessId, { email: old.email, fullName: old.fullName });
  }

  async revokeInvitation(businessId: string, invitationId: string) {
    const invitation = this.invitations.get(invitationId);
    if (!invitation || invitation.businessId !== businessId)
      throw new Error('Invitación no encontrada');
    invitation.status = 'REVOKED';
  }

  async acceptInvitation(input: {
    userId: string;
    email: string;
    token: string;
    fullName: string | null;
  }) {
    const invitation = [...this.invitations.values()].find(
      (candidate) => candidate.token === input.token && candidate.status === 'PENDING',
    );
    if (
      !invitation ||
      invitation.expiresAt <= new Date() ||
      invitation.email !== input.email.toLowerCase()
    )
      throw new Error('Invitación inválida');
    this.identity.addMember(input.userId, invitation.businessId, 'OWNER');
    invitation.status = 'ACCEPTED';
    const business = this.identity.businesses.get(invitation.businessId)!;
    return {
      businessId: business.id,
      businessName: business.name,
      timezone: business.timezone,
      businessCreatedAt: business.createdAt,
      profileId: input.userId,
      fullName: input.fullName ?? invitation.fullName,
    };
  }
}

export class InMemoryCustomers implements CustomerRepository {
  readonly rows: CustomerRecord[] = [];
  /** Clientes referenciados por turnos: simula la FK con onDelete: Restrict. */
  readonly withAppointments = new Set<string>();

  async list(businessId: string, { search, page, pageSize }: ListQuery) {
    const s = search?.toLowerCase();
    const all = this.rows
      .filter((c) => c.businessId === businessId)
      .filter(
        (c) =>
          !s || c.fullName.toLowerCase().includes(s) || (c.email ?? '').toLowerCase().includes(s),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length };
  }

  async findById(businessId: string, id: string) {
    return this.rows.find((c) => c.id === id && c.businessId === businessId) ?? null;
  }

  async create(businessId: string, data: CustomerData) {
    const now = new Date();
    const row = { id: randomUUID(), businessId, ...data, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }

  async update(businessId: string, id: string, data: Partial<CustomerData>) {
    const row = await this.findById(businessId, id);
    if (!row) return null;
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }

  async delete(businessId: string, id: string) {
    const index = this.rows.findIndex((c) => c.id === id && c.businessId === businessId);
    if (index === -1) return 'not_found' as const;
    if (this.withAppointments.has(id)) return 'has_appointments' as const;
    this.rows.splice(index, 1);
    return 'deleted' as const;
  }
}

export class InMemoryAppointments implements EventRepository, RiskRepository {
  readonly appointments = new Map<string, string>(); // appointmentId -> businessId
  readonly events: (EventRecord & { businessId: string })[] = [];
  readonly risks = new Map<string, RiskRecord>();

  addAppointment(businessId: string, id = randomUUID()) {
    this.appointments.set(id, businessId);
    return id;
  }

  async listForAppointment(businessId: string, appointmentId: string) {
    if (this.appointments.get(appointmentId) !== businessId) return null;
    return this.events
      .filter((e) => e.appointmentId === appointmentId && e.businessId === businessId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async find(businessId: string, appointmentId: string) {
    if (this.appointments.get(appointmentId) !== businessId) {
      return { appointmentExists: false as const };
    }
    return { appointmentExists: true as const, risk: this.risks.get(appointmentId) ?? null };
  }

  async upsert(businessId: string, input: RiskScoreInput) {
    const row: RiskRecord = { ...input, calculatedAt: new Date() };
    this.risks.set(input.appointmentId, row);
    return row;
  }
}

export class FakeLlm implements LlmClient {
  readonly model = 'fake-model';
  readonly calls: LlmRequest[] = [];
  constructor(public handler: (req: LlmRequest) => Promise<string>) {}

  generateJson(req: LlmRequest) {
    this.calls.push(req);
    return this.handler(req);
  }
}

export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  const verifier = new FakeVerifier();
  const identity = new InMemoryIdentity();
  const customers = new InMemoryCustomers();
  const services = new InMemoryServices();
  const availability = new InMemoryAvailability(identity);
  const slots = new InMemorySlots(services);
  const appointments = new InMemoryAppointments();
  const admin = new InMemoryAdmin(identity);
  const appointmentRepository = new InMemoryAppointmentRepository(
    overrides.customers ?? customers,
    overrides.services ?? services,
    overrides.availability ?? availability,
  );
  const deps: AppDeps = {
    corsOrigins: ['http://localhost:3000'],
    verifier,
    identity,
    admin,
    customers,
    services,
    availability,
    slots,
    appointments: appointmentRepository,
    events: appointments,
    risk: appointments,
    explainer: null,
    aiRateLimit: { limit: 100, windowMs: 60_000 },
    checkReady: async () => true,
    ...overrides,
  };
  return {
    app: createApp(deps),
    verifier,
    identity,
    admin,
    customers,
    services,
    availability,
    appointments,
    appointmentRepository,
    slots,
  };
}
