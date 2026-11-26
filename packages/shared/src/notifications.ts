import { z } from 'zod';
import { APPOINTMENT_EMAIL_KINDS } from './email-templates.js';

export const NOTIFICATION_LEAD_MS = 10 * 60_000;
export const emailPreviewKindSchema = z.enum([
  'BOOKED',
  'CONFIRMED',
  'REMINDER_24H',
  'REMINDER_48H',
  'REMINDER',
  'CANCELLED',
  'RESCHEDULED',
  'RESCHEDULE_DECLINED',
]);

// Type check: ensure emailPreviewKindSchema values match APPOINTMENT_EMAIL_KINDS
type _PreviewKindCheck =
  z.infer<typeof emailPreviewKindSchema> extends (typeof APPOINTMENT_EMAIL_KINDS)[number]
    ? (typeof APPOINTMENT_EMAIL_KINDS)[number] extends z.infer<typeof emailPreviewKindSchema>
      ? true
      : false
    : false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _: _PreviewKindCheck = true;
export interface EmailPreviewDto {
  subject: string;
  html: string;
}

export type NotificationKind =
  | 'APPOINTMENT_UPCOMING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'RESCHEDULED'
  | 'RESCHEDULE_REQUESTED'
  | 'MARKED_NO_SHOW'
  | 'COMPLETED';

export interface NotificationDto<K = NotificationKind> {
  id: string;
  appointmentId: string | null;
  kind: K;
  startsAt: string;
  createdAt: string;
  readAt: string | null;
}

export const notificationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().uuid().optional(),
    filter: z.enum(['all', 'unread']).default('all'),
    includeRequests: z.stringbool().optional(),
  })
  .strict();

export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
export interface NotificationsResponse<K = NotificationKind> {
  items: NotificationDto<K>[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface NotificationReadResponse {
  readAt: string;
  unreadCount: number;
}

export interface UpcomingNotification {
  id: string;
  appointmentId: string;
  startsAt: string;
}
