import { z } from 'zod';
import { logger } from '../../lib/logger.js';

export const emailMessageSchema = z.object({
  from: z.string(),
  to: z.email(),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
});
export type EmailMessage = z.infer<typeof emailMessageSchema>;

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage, idempotencyKey: string): Promise<{ id: string }>;
}

export class EmailDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly fetchEmail = fetch,
  ) {}

  async send(message: EmailMessage, idempotencyKey: string) {
    let response: Response;
    try {
      response = await this.fetchEmail('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new EmailDeliveryError('RESEND_CONNECTION_ERROR', true);
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = z.object({ name: z.string() }).safeParse(body);
      const concurrent =
        response.status === 409 && error.data?.name === 'concurrent_idempotent_requests';
      throw new EmailDeliveryError(
        `RESEND_HTTP_${response.status}`,
        concurrent || response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    const accepted = z.object({ id: z.uuid() }).safeParse(body);
    if (!accepted.success) throw new EmailDeliveryError('RESEND_INVALID_RESPONSE', true);
    return accepted.data;
  }
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage, idempotencyKey: string) {
    logger.info('appointment_email_simulated', { idempotencyKey, subject: message.subject });
    return { id: `console:${idempotencyKey}` };
  }
}
