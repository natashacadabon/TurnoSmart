import { Prisma, type AppointmentEvent, type PrismaClient } from '@prisma/client';
import {
  NOTIFICATION_LEAD_MS,
  type AuthContext,
  type NotificationReadResponse,
  type NotificationsQuery,
  type NotificationsResponse,
  type UpcomingNotification,
} from '@turnosmart/shared';
import { notFound } from '../../lib/errors.js';

type Scope = Pick<AuthContext, 'businessId' | 'userId'>;

function unread({ businessId, userId }: Scope): Prisma.NotificationWhereInput {
  return { businessId, reads: { none: { profileId: userId, businessId } } };
}

export async function recordAppointmentNotification(
  tx: Prisma.TransactionClient,
  event: AppointmentEvent,
  startsAt: Date,
) {
  if (event.type === 'CREATED') return;
  await tx.notification.create({
    data: {
      businessId: event.businessId,
      appointmentId: event.appointmentId,
      kind: event.type,
      sourceKey: 'event:' + event.id,
      startsAt,
      createdAt: event.createdAt,
    },
  });
}

export class PrismaNotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(scope: Scope, query: NotificationsQuery): Promise<NotificationsResponse> {
    const { businessId, userId } = scope;
    return this.prisma.$transaction(
      async (tx) => {
        // Resolve the cursor within the tenant before using it as an ordering anchor.
        const anchor = query.cursor
          ? await tx.notification.findUnique({
              where: { id_businessId: { id: query.cursor, businessId } },
              select: { id: true, createdAt: true },
            })
          : null;
        if (query.cursor && !anchor) throw notFound('Notificación');
        const rows = await tx.notification.findMany({
          where: {
            ...(query.filter === 'unread' ? unread(scope) : { businessId }),
            ...(anchor && {
              OR: [
                { createdAt: { lt: anchor.createdAt } },
                { createdAt: anchor.createdAt, id: { lt: anchor.id } },
              ],
            }),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
          select: {
            id: true,
            kind: true,
            startsAt: true,
            createdAt: true,
            appointment: { select: { id: true, businessId: true } },
            reads: { where: { profileId: userId, businessId }, select: { readAt: true } },
          },
        });
        const items = rows.slice(0, query.limit).map((row) => ({
          id: row.id,
          kind: row.kind,
          appointmentId: row.appointment?.businessId === businessId ? row.appointment.id : null,
          startsAt: row.startsAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
          readAt: row.reads[0]?.readAt.toISOString() ?? null,
        }));
        return {
          items,
          unreadCount: await tx.notification.count({ where: unread(scope) }),
          nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  markRead(scope: Scope, notificationId: string): Promise<NotificationReadResponse> {
    const { businessId, userId: profileId } = scope;
    return this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.findUnique({
        where: { id_businessId: { id: notificationId, businessId } },
        select: { id: true },
      });
      if (!notification) throw notFound('Notificación');
      await tx.notificationRead.createMany({
        data: { businessId, notificationId, profileId },
        skipDuplicates: true,
      });
      const receipt = await tx.notificationRead.findUniqueOrThrow({
        where: { notificationId_profileId: { notificationId, profileId } },
      });
      return {
        readAt: receipt.readAt.toISOString(),
        unreadCount: await tx.notification.count({ where: unread(scope) }),
      };
    });
  }

  async markAllRead({ businessId, userId }: Scope) {
    await this.prisma.$executeRaw`
      INSERT INTO public.notification_reads (business_id, notification_id, profile_id)
      SELECT n.business_id, n.id, ${userId}::uuid
      FROM public.notifications n
      WHERE n.business_id = ${businessId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM public.notification_reads r
          WHERE r.notification_id = n.id AND r.profile_id = ${userId}::uuid
        )
      ON CONFLICT (notification_id, profile_id) DO NOTHING
    `;
  }

  syncUpcoming(
    { businessId, timezone }: Pick<AuthContext, 'businessId' | 'timezone'>,
    now = new Date(),
  ): Promise<UpcomingNotification[]> {
    const until = new Date(now.getTime() + NOTIFICATION_LEAD_MS);
    const due = Prisma.sql`
      a.business_id = ${businessId}::uuid AND a.status IN ('SCHEDULED', 'CONFIRMED')
      AND a.starts_at >= (date_trunc('day', ${now}::timestamptz AT TIME ZONE ${timezone})
                           AT TIME ZONE ${timezone})
      AND a.starts_at <= ${until}::timestamptz
    `;
    const key = Prisma.sql`'upcoming:' || a.id::text || ':' ||
      (extract(epoch FROM a.starts_at) * 1000)::bigint::text`;
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
        INSERT INTO public.notifications (business_id, appointment_id, kind, source_key, starts_at)
        SELECT a.business_id, a.id, 'APPOINTMENT_UPCOMING', ${key}, a.starts_at
        FROM public.appointments a
        WHERE ${due}
        ON CONFLICT (business_id, source_key) DO NOTHING
      `;
        // A concurrent sync may have won the insert. Read in a new statement.
        const rows = await tx.$queryRaw<{ id: string; appointmentId: string; startsAt: Date }[]>`
        SELECT n.id, n.appointment_id AS "appointmentId", n.starts_at AS "startsAt"
        FROM public.appointments a
        JOIN public.notifications n ON n.business_id = a.business_id AND n.source_key = ${key}
        WHERE ${due}
      `;
        return rows.map((row) => ({ ...row, startsAt: row.startsAt.toISOString() }));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
