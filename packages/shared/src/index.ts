export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type { ServiceDto } from './services.js';
export type { AvailabilityRuleDto } from './availability.js';
export type { SlotDto } from './slots.js';
export { SLOT_INTERVAL_MINUTES } from './slots.js';
