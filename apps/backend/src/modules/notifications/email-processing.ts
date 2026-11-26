import { logger } from '../../lib/logger.js';

/** Coalesce wakeups while retaining requests that arrive during an active drain. */
export function emailProcessing(drain: () => Promise<void>) {
  let requested = false;
  let running: Promise<void> | undefined;
  let scheduled = false;
  let closed = false;

  async function run() {
    try {
      while (requested && !closed) {
        requested = false;
        await drain();
      }
    } catch {
      // Persisted jobs remain available to polling, Cron and the provider retry policy.
      logger.error('appointment_email_queue_error');
    } finally {
      running = undefined;
    }
  }

  return {
    request() {
      if (closed) return;
      requested = true;
      if (scheduled || running) return;
      scheduled = true;
      setImmediate(() => {
        scheduled = false;
        if (!closed) running = run();
      });
    },
    async close() {
      closed = true;
      await running;
    },
  };
}
