import { expect, it, vi } from 'vitest';
import { emailProcessing } from '../../src/modules/notifications/email-processing.js';

it('procesa sin polling, agrupa solicitudes y conserva las que llegan durante el envío', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const drain = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
  const processor = emailProcessing(drain);
  processor.request();
  processor.request();
  expect(drain).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1));
  processor.request();
  release();
  await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(2));
  await processor.close();
  processor.request();
  expect(drain).toHaveBeenCalledTimes(2);
});

it('permite recuperar la cola en otra solicitud después de un fallo', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const drain = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue(undefined);
  const processor = emailProcessing(drain);
  try {
    processor.request();
    await vi.waitFor(() => expect(log).toHaveBeenCalled());
    processor.request();
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(2));
  } finally {
    await processor.close();
    log.mockRestore();
  }
});
