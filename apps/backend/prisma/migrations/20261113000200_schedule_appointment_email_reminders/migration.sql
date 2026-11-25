BEGIN;

-- Shared by booking, preference changes and the initial backfill.
CREATE FUNCTION public.schedule_appointment_email_reminders(
  target_business uuid, target_appointment uuid, as_of timestamptz
) RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO public.reminders (
    business_id, appointment_id, email_kind, deduplication_key, schedule_version,
    recipient, scheduled_at, email_data, updated_at
  )
  SELECT a.business_id, a.id, lead.kind,
    'appointment-reminder:' || a.id || ':' || a.schedule_version || ':' || lead.hours,
    a.schedule_version, c.email, due.at,
    jsonb_build_object(
      'business', b.name, 'customer', c.full_name, 'service', s.name,
      'startsAt', to_char(a.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone', b.timezone
    ), as_of
  FROM public.appointments a
  JOIN public.businesses b ON b.id = a.business_id
  JOIN public.customers c ON (c.id, c.business_id) = (a.customer_id, a.business_id)
  JOIN public.services s ON (s.id, s.business_id) = (a.service_id, a.business_id)
  CROSS JOIN LATERAL (VALUES
    (48, 'REMINDER_48H'::public."AppointmentEmailKind", b.reminder_48h_enabled),
    (24, 'REMINDER_24H'::public."AppointmentEmailKind", b.reminder_24h_enabled)
  ) AS lead(hours, kind, enabled)
  CROSS JOIN LATERAL (SELECT a.starts_at - make_interval(hours => lead.hours)) AS due(at)
  WHERE a.business_id = target_business
    AND (target_appointment IS NULL OR a.id = target_appointment)
    AND a.status = 'SCHEDULED' AND c.email IS NOT NULL
    AND lead.enabled AND due.at >= as_of
  ON CONFLICT (deduplication_key) DO UPDATE
    SET status = 'PENDING', scheduled_at = EXCLUDED.scheduled_at,
        recipient = EXCLUDED.recipient, email_data = EXCLUDED.email_data,
        error_message = NULL, updated_at = EXCLUDED.updated_at
    WHERE reminders.attempts = 0 AND reminders.lease_until IS NULL
      AND (reminders.status = 'PENDING' OR (
        reminders.status = 'CANCELLED' AND reminders.error_message = 'REMINDER_DISABLED'
      ));
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_appointment_email_reminders(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_appointment_email_reminders(uuid, uuid, timestamptz)
  TO service_role;

SELECT public.schedule_appointment_email_reminders(id, NULL, statement_timestamp())
FROM public.businesses
WHERE reminder_48h_enabled OR reminder_24h_enabled;

COMMIT;
