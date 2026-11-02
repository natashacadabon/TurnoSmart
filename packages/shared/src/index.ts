export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export * from './services.js';
export * from './availability.js';
export type { SlotDto } from './slots.js';
export { SLOT_INTERVAL_MINUTES } from './slots.js';
// Contratos compartidos entre frontend y backend (A01). Cada módulo edita su propio archivo.
export * from './errors.js';
export * from './identity.js';
export * from './customers.js';
export * from './appointments.js';
