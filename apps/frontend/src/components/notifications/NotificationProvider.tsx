'use client';

import type {
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

export function listNotifications(filter: 'all' | 'unread', limit: number, cursor?: string) {
  const query = new URLSearchParams({ filter, limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return api<NotificationsResponse>('/api/notifications?' + query);
}

interface Center {
  recent: NotificationsResponse | null;
  error: string;
  refresh(force?: boolean): Promise<void>;
  markRead(id: string): Promise<NotificationReadResponse>;
  markAllRead(): Promise<string>;
  syncUpcoming(): Promise<UpcomingNotification[]>;
}

const Context = createContext<Center | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [recent, setRecent] = useState<NotificationsResponse | null>(null);
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

  const refresh = useCallback((force = false) => {
    if (!force && listing.current) return listing.current;
    const version = ++revision.current;
    const request = listNotifications('all', 8)
      .then(
        (result) => {
          if (version !== revision.current) return;
          setRecent(result);
          setError('');
        },
        (err) => {
          if (version === revision.current) setError(errorMessage(err));
        },
      )
      .finally(() => {
        if (listing.current === request) listing.current = null;
      });
    listing.current = request;
    return request;
  }, []);

  const markRead = useCallback(
    (id: string) => {
      const pending = reading.current.get(id);
      if (pending) return pending;
      const request = api<NotificationReadResponse>('/api/notifications/' + id + '/read', {
        method: 'PATCH',
      })
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
    const request = api<void>('/api/notifications/read-all', { method: 'PATCH' })
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
    <Context.Provider value={{ recent, error, refresh, markRead, markAllRead, syncUpcoming }}>
      {children}
    </Context.Provider>
  );
}

export function useNotifications() {
  const context = useContext(Context);
  if (!context) throw new Error('useNotifications requiere NotificationProvider');
  return context;
}
