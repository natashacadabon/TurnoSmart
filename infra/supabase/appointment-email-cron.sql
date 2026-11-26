-- Ejecutar en el editor SQL de Supabase después de aplicar las migraciones.
-- Habilitar pg_cron y pg_net y guardar en Vault los secretos
-- appointment_email_backend_url (origen HTTPS) y appointment_email_cron_secret.
-- El segundo debe coincidir con EMAIL_CRON_SECRET del backend.
-- Usar el mismo job por entorno. Para desactivarlo: SELECT cron.unschedule('turnosmart-appointment-email');
SELECT cron.schedule('turnosmart-appointment-email', '*/5 * * * *', $job$
  SELECT net.http_post(
    url := rtrim(backend.decrypted_secret, '/') || '/internal/email-jobs',
    headers := jsonb_build_object('Authorization', 'Bearer ' || auth.decrypted_secret),
    timeout_milliseconds := 120000
  )
  FROM vault.decrypted_secrets backend
  CROSS JOIN vault.decrypted_secrets auth
  WHERE backend.name = 'appointment_email_backend_url'
    AND auth.name = 'appointment_email_cron_secret'
    AND EXISTS (
      SELECT 1 FROM public.reminders
      WHERE email_kind IS NOT NULL AND status = 'PENDING'
        AND scheduled_at <= statement_timestamp()
        AND (lease_until IS NULL OR lease_until <= statement_timestamp())
    );
$job$);
