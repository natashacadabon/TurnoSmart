import type { AppointmentEmailKind as PrismaEmailKind } from '@prisma/client';
import {
  APPOINTMENT_EMAIL_KINDS,
  appointmentEmailDataSchema,
  renderAppointmentEmail as sharedRenderAppointmentEmail,
  type AppointmentEmailKind,
} from '@turnosmart/shared';

// Type check: ensure Prisma enum is compatible with shared type union
// This compile-time assertion prevents divergence
type _PrismaCheck = PrismaEmailKind extends AppointmentEmailKind
  ? AppointmentEmailKind extends PrismaEmailKind
    ? true
    : false
  : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _: _PrismaCheck = true;

export const appointmentEmailData = appointmentEmailDataSchema;
export type { AppointmentEmailKind };
export { APPOINTMENT_EMAIL_KINDS, sharedRenderAppointmentEmail as renderAppointmentEmail };
