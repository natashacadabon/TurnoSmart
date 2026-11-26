BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN confirmation_email_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN reminders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN reminder_hours integer[] NOT NULL DEFAULT ARRAY[48,24],
  ADD COLUMN customer_confirmation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN customer_reschedule_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN reschedule_minimum_hours integer NOT NULL DEFAULT 0;

-- Existing businesses retain their selected email and reminder preferences.
UPDATE public.businesses
SET confirmation_email_enabled = booking_email_enabled,
    reminders_enabled = reminder_48h_enabled OR reminder_24h_enabled,
    reminder_hours = CASE
      WHEN reminder_48h_enabled AND reminder_24h_enabled THEN ARRAY[48,24]
      WHEN reminder_48h_enabled THEN ARRAY[48]
      WHEN reminder_24h_enabled THEN ARRAY[24]
      ELSE ARRAY[]::integer[]
    END;

ALTER TABLE public.businesses
  ALTER COLUMN booking_email_enabled SET DEFAULT true,
  ALTER COLUMN reminder_48h_enabled SET DEFAULT true,
  ALTER COLUMN reminder_24h_enabled SET DEFAULT true,
  ADD CONSTRAINT business_reminder_hours_check CHECK (
    cardinality(reminder_hours) <= 3
    AND reminder_hours <@ ARRAY[2,6,12,24,48,72]
    AND array_position(reminder_hours, NULL) IS NULL
    AND cardinality(reminder_hours) =
      (CASE WHEN 2 = ANY(reminder_hours) THEN 1 ELSE 0 END +
       CASE WHEN 6 = ANY(reminder_hours) THEN 1 ELSE 0 END +
       CASE WHEN 12 = ANY(reminder_hours) THEN 1 ELSE 0 END +
       CASE WHEN 24 = ANY(reminder_hours) THEN 1 ELSE 0 END +
       CASE WHEN 48 = ANY(reminder_hours) THEN 1 ELSE 0 END +
       CASE WHEN 72 = ANY(reminder_hours) THEN 1 ELSE 0 END)
  ),
  ADD CONSTRAINT business_reschedule_minimum_hours_check
    CHECK (reschedule_minimum_hours BETWEEN 0 AND 720);

ALTER TABLE public.reminders ADD COLUMN reminder_offset_hours integer;
UPDATE public.reminders
SET reminder_offset_hours = CASE email_kind
  WHEN 'REMINDER_48H' THEN 48 WHEN 'REMINDER_24H' THEN 24 END
WHERE email_kind IN ('REMINDER_48H', 'REMINDER_24H');
ALTER TABLE public.reminders ADD CONSTRAINT reminder_offset_hours_check
  CHECK (reminder_offset_hours IS NULL OR reminder_offset_hours IN (2,6,12,24,48,72));

CREATE OR REPLACE FUNCTION public.schedule_appointment_email_reminders(
  target_business uuid, target_appointment uuid, as_of timestamptz
) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Cancel pending offsets removed by the business, including leased rows.
  -- A request already accepted by the email provider cannot be recalled.
  UPDATE public.reminders r
  SET status = 'CANCELLED', lease_until = NULL,
      error_message = 'REMINDER_DISABLED', updated_at = as_of
  FROM public.businesses b
  WHERE b.id = target_business AND r.business_id = b.id
    AND (target_appointment IS NULL OR r.appointment_id = target_appointment)
    AND r.email_kind IN ('REMINDER', 'REMINDER_48H', 'REMINDER_24H')
    AND r.status = 'PENDING'
    AND (NOT b.reminders_enabled OR NOT (r.reminder_offset_hours = ANY(b.reminder_hours)));

  INSERT INTO public.reminders (
    business_id, appointment_id, email_kind, reminder_offset_hours, deduplication_key,
    schedule_version, recipient, scheduled_at, email_data, updated_at
  )
  SELECT a.business_id, a.id,
    CASE lead.hours
      WHEN 48 THEN 'REMINDER_48H'::public."AppointmentEmailKind"
      WHEN 24 THEN 'REMINDER_24H'::public."AppointmentEmailKind"
      ELSE 'REMINDER'::public."AppointmentEmailKind" END,
    lead.hours,
    'appointment-reminder:' || a.id || ':' || a.schedule_version || ':' || lead.hours,
    a.schedule_version, c.email, due.at,
    jsonb_build_object(
      'business', b.name, 'customer', c.full_name, 'service', s.name,
      'startsAt', to_char(a.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone', b.timezone, 'reminderHours', lead.hours
    ), as_of
  FROM public.appointments a
  JOIN public.businesses b ON b.id = a.business_id
  JOIN public.customers c ON (c.id, c.business_id) = (a.customer_id, a.business_id)
  JOIN public.services s ON (s.id, s.business_id) = (a.service_id, a.business_id)
  CROSS JOIN LATERAL unnest(b.reminder_hours) AS lead(hours)
  CROSS JOIN LATERAL (SELECT a.starts_at - make_interval(hours => lead.hours)) AS due(at)
  WHERE a.business_id = target_business
    AND (target_appointment IS NULL OR a.id = target_appointment)
    AND a.status = 'SCHEDULED' AND c.email IS NOT NULL
    AND b.reminders_enabled AND due.at >= as_of
  ON CONFLICT (deduplication_key) DO UPDATE
    SET status = 'PENDING', scheduled_at = EXCLUDED.scheduled_at,
        reminder_offset_hours = EXCLUDED.reminder_offset_hours,
        recipient = EXCLUDED.recipient, email_data = EXCLUDED.email_data,
        error_message = NULL, updated_at = EXCLUDED.updated_at
    WHERE reminders.attempts = 0 AND reminders.lease_until IS NULL
      AND (reminders.status = 'PENDING' OR (
        reminders.status = 'CANCELLED' AND reminders.error_message = 'REMINDER_DISABLED'
      ));
END;
$$;

COMMIT;
