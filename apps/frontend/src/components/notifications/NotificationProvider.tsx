'use client';

import type {
  AppointmentDto,
  NotificationDto,
  NotificationReadResponse,
  NotificationsResponse,
  UpcomingNotification,
} from '@turnosmart/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, errorMessage } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useUnsavedChanges } from '@/components/UnsavedChangesProvider';
import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/ToastProvider';

export function listNotifications(filter: 'all' | 'unread', limit: number, cursor?: string) {
  const query = new URLSearchParams({ filter, limit: String(limit), includeRequests: 'true' });
  if (cursor) query.set('cursor', cursor);
  return api<CenterNotifications>('/api/notifications?' + query);
}

export type CenterNotifications = NotificationsResponse;

interface Center {
  recent: CenterNotifications | null;
  appointmentRevision: number;
  navigationRevision: number;
  popoverOpen: boolean;
  setPopoverOpen(open: boolean): void;
  error: string;
  refresh(force?: boolean): Promise<void>;
  markRead(id: string): Promise<NotificationReadResponse>;
  markAllRead(): Promise<string>;
  syncUpcoming(): Promise<UpcomingNotification[]>;
  openAppointment(item: NotificationDto, beforeNavigate?: () => Promise<void>): Promise<boolean>;
}

const Context = createContext<Center | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const { notify, setPaused } = useToast();
  const router = useRouter();
  const { allowNavigation } = useUnsavedChanges();
  const timezone = me?.onboarded ? me.business.timezone : 'UTC';
  const [recent, setRecent] = useState<CenterNotifications | null>(null);
  const [appointmentRevision, setAppointmentRevision] = useState(0);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [popoverOpen, setPopoverOpen] = useState(false);
  useEffect(() => {
    setPaused(popoverOpen);
    return () => setPaused(false);
  }, [popoverOpen, setPaused]);
  const seen = useRef<Set<string> | null>(null);
  const observedUnread = useRef<number | null>(null);
  const reconciledAt = useRef(0);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const listing = useRef<Promise<void> | null>(null);
  const upcoming = useRef<Promise<UpcomingNotification[]> | null>(null);
  const reading = useRef(new Map<string, Promise<NotificationReadResponse>>());
  const bulkReading = useRef<Promise<string> | null>(null);

  const invalidate = useCallback(() => {
    revision.current++;
    listing.current = null;
  }, []);
  useEffect(() => invalidate, [invalidate]);

  const openAppointment = useCallback(
    async (item: NotificationDto, beforeNavigate?: () => Promise<void>) => {
      if (!item.appointmentId || !allowNavigation()) return false;
      if (beforeNavigate) await beforeNavigate();
      setNavigationRevision((value) => value + 1);
      setAppointmentRevision((value) => value + 1);
      const target = '/appointments/' + item.appointmentId;
      router.push(
        item.kind === 'RESCHEDULE_REQUESTED'
          ? target +
              '?solicitud=' +
              encodeURIComponent(item.createdAt) +
              '#solicitud-reprogramacion'
          : target,
      );
      return true;
    },
    [allowNavigation, router],
  );

  const refresh = useCallback(
    (force = false) => {
      if (!force && listing.current) return listing.current;
      const version = ++revision.current;
      const request = listNotifications('all', 8)
        .then(async (result) => {
          if (version !== revision.current) return;
          const known = seen.current;
          const reconcile =
            !known ||
            result.unreadCount !== observedUnread.current ||
            result.items.some((item) => !known.has(item.id)) ||
            Date.now() - reconciledAt.current >= 60_000;
          const observed = [...result.items];
          if (reconcile) {
            // createdAt is not commit order: a transaction waiting on a lock can publish an
            // older event. Reconcile the existing cursor feed without stopping at known IDs.
            let cursor = result.nextCursor;
            while (cursor && version === revision.current) {
              const page = await listNotifications('all', 50, cursor);
              observed.push(...page.items);
              cursor = page.nextCursor;
            }
          }
          if (version !== revision.current) return;
          const added = known ? observed.filter((item) => !known.has(item.id)) : [];
          const format = new Intl.DateTimeFormat('es-AR', {
            dateStyle: 'short',
            timeStyle: 'short',
            hourCycle: 'h23',
            timeZone: timezone,
          });
          const labels: Record<NotificationDto['kind'], string> = {
            RESCHEDULE_REQUESTED: 'Nueva solicitud de reprogramación',
            CANCELLED: 'Turno cancelado',
            CONFIRMED: 'Asistencia confirmada',
            RESCHEDULED: 'Turno reprogramado',
            COMPLETED: 'Turno completado',
            MARKED_NO_SHOW: 'Inasistencia registrada',
            APPOINTMENT_UPCOMING: 'Turno próximo',
          };
          const priority = (kind: NotificationDto['kind']) =>
            kind === 'RESCHEDULE_REQUESTED' ? 0 : kind === 'CANCELLED' ? 1 : 2;
          const toasts: { item: NotificationDto; actionLabel: string }[] = [];
          for (const item of [...added].sort((a, b) => priority(a.kind) - priority(b.kind))) {
            if (item.readAt) continue;
            // Agenda already has its actionable upcoming-turn widget.
            if (item.kind === 'APPOINTMENT_UPCOMING' && window.location.pathname === '/') continue;
            let actionLabel =
              item.kind === 'RESCHEDULE_REQUESTED' ? 'Revisar solicitud' : 'Ver turno';
            if (item.kind === 'APPOINTMENT_UPCOMING' && item.appointmentId) {
              try {
                const current = await api<AppointmentDto>(
                  '/api/appointments/' + item.appointmentId,
                );
                if (
                  !['SCHEDULED', 'CONFIRMED'].includes(current.status) ||
                  current.startsAt !== item.startsAt ||
                  Date.parse(current.startsAt) <= Date.now()
                )
                  continue;
                actionLabel =
                  current.status === 'SCHEDULED' && current.confirmationStatus !== 'CONFIRMED'
                    ? 'Gestionar turno'
                    : 'Ver turno';
              } catch {
                continue;
              }
            }
            if (version !== revision.current) return;
            toasts.push({ item, actionLabel });
          }
          if (version !== revision.current) return;
          seen.current ??= new Set();
          for (const item of observed) seen.current.add(item.id);
          observedUnread.current = result.unreadCount;
          if (reconcile) reconciledAt.current = Date.now();
          if (added.some((item) => item.appointmentId && item.kind !== 'APPOINTMENT_UPCOMING')) {
            setAppointmentRevision((value) => value + 1);
          }
          for (const { item, actionLabel } of toasts) {
            notify(`${labels[item.kind]} · ${format.format(new Date(item.startsAt))}`, 'info', {
              key: item.id,
              enqueue: true,
              ...(item.appointmentId && {
                action: { label: actionLabel, onClick: () => openAppointment(item) },
              }),
            });
          }
          setRecent(result);
          setError('');
        })
        .catch((err) => {
          if (version === revision.current) setError(errorMessage(err));
        })
        .finally(() => {
          if (listing.current === request) listing.current = null;
        });
      listing.current = request;
      return request;
    },
    [notify, timezone, openAppointment],
  );

  useEffect(() => {
    const refreshVisible = () => {
      if (!document.hidden) void refresh();
    };
    refreshVisible();
    const timer = window.setInterval(refreshVisible, 5_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [refresh]);

  const markRead = useCallback(
    (id: string) => {
      const pending = reading.current.get(id);
      if (pending) return pending;
      const request = api<NotificationReadResponse>(
        '/api/notifications/' + id + '/read?includeRequests=true',
        {
          method: 'PATCH',
        },
      )
        .then((result) => {
          invalidate();
          setRecent((previous) =>
            previous
              ? {
                  ...previous,
                  unreadCount: result.unreadCount,
                  items: previous.items.map((item) =>
                    item.id === id ? { ...item, readAt: result.readAt } : item,
                  ),
                }
              : previous,
          );
          return result;
        })
        .finally(() => reading.current.delete(id));
      reading.current.set(id, request);
      return request;
    },
    [invalidate],
  );

  const markAllRead = useCallback(() => {
    if (bulkReading.current) return bulkReading.current;
    const request = api<void>('/api/notifications/read-all?includeRequests=true', {
      method: 'PATCH',
    })
      .then(() => {
        invalidate();
        const readAt = new Date().toISOString();
        setRecent((previous) =>
          previous
            ? {
                ...previous,
                unreadCount: 0,
                items: previous.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
              }
            : previous,
        );
        return readAt;
      })
      .finally(() => {
        bulkReading.current = null;
      });
    bulkReading.current = request;
    return request;
  }, [invalidate]);

  const syncUpcoming = useCallback(() => {
    if (upcoming.current) return upcoming.current;
    const request = api<{ items: UpcomingNotification[] }>('/api/notifications/sync-upcoming', {
      method: 'POST',
    })
      .then(({ items }) => {
        if (items.length) void refresh(true);
        return items;
      })
      .finally(() => {
        upcoming.current = null;
      });
    upcoming.current = request;
    return request;
  }, [refresh]);

  return (
    <Context.Provider
      value={{
        recent,
        appointmentRevision,
        navigationRevision,
        popoverOpen,
        setPopoverOpen,
        error,
        refresh,
        markRead,
        markAllRead,
        syncUpcoming,
        openAppointment,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useNotifications() {
  const context = useContext(Context);
  if (!context) throw new Error('useNotifications requiere NotificationProvider');
  return context;
}
