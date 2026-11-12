import { z } from 'zod';

export const NOTIFICATION_LEAD_MS = 10 * 60_000;

export type NotificationKind =
  | 'APPOINTMENT_UPCOMING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'RESCHEDULED'
  | 'MARKED_NO_SHOW'
  | 'COMPLETED';

export interface NotificationDto {
  id: string;
  appointmentId: string | null;
  kind: NotificationKind;
  startsAt: string;
  createdAt: string;
  readAt: string | null;
}

export const notificationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().uuid().optional(),
    filter: z.enum(['all', 'unread']).default('all'),
  })
  .strict();

export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
export interface NotificationsResponse {
  items: NotificationDto[];
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
