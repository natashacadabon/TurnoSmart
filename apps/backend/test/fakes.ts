import { InMemoryServices } from './services-fakes.js';
import { InMemoryAvailability } from './availability-fakes.js';
import { InMemorySlots } from './slots-fakes.js';
import { randomUUID } from 'node:crypto';
import { createApp, type AppDeps } from '../src/app.js';
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
  PlatformAdminRecord,
  ProfileRecord,
  ProfileWithBusiness,
} from '../src/modules/identity/repository.js';

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
  readonly admins = new Map<string, PlatformAdminRecord>();
  private readonly preferences = {
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

  /** Perfil OWNER de un negocio. `active: false` simula un OWNER desactivado por un ADMIN. */
  addMember(userId: string, businessId: string, role: 'OWNER' = 'OWNER', active = true) {
    if (!this.businesses.has(businessId)) {
      this.businesses.set(businessId, {
        ...this.preferences,
        id: businessId,
        name: 'Negocio',
        timezone: 'UTC',
        createdAt: new Date(),
      });
    }
    this.profiles.set(userId, { id: userId, businessId, fullName: null, role, active });
  }

  /** ADMIN global de la plataforma, sin negocio. */
  addPlatformAdmin(userId: string, active = true) {
    this.admins.set(userId, { id: userId, fullName: 'Admin', active });
  }

  async findProfileWithBusiness(userId: string): Promise<ProfileWithBusiness | null> {
    const profile = this.profiles.get(userId);
    if (!profile) return null;
    return { profile, business: this.businesses.get(profile.businessId)! };
  }

  async findPlatformAdmin(userId: string) {
    return this.admins.get(userId) ?? null;
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
  const appointmentRepository = new InMemoryAppointmentRepository(
    overrides.customers ?? customers,
    overrides.services ?? services,
    overrides.availability ?? availability,
  );
  const deps: AppDeps = {
    corsOrigins: ['http://localhost:3000'],
    verifier,
    identity,
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
    customers,
    services,
    availability,
    appointments,
    appointmentRepository,
    slots,
  };
}
