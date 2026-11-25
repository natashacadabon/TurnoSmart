BEGIN;

CREATE TYPE "AppointmentEmailKind" AS ENUM (
  'BOOKED', 'CONFIRMED', 'CANCELLED', 'RESCHEDULED', 'RESCHEDULE_DECLINED'
);

ALTER TABLE "reminders"
  ADD COLUMN "email_kind" "AppointmentEmailKind",
  ADD COLUMN "deduplication_key" TEXT,
  ADD COLUMN "schedule_version" INTEGER,
  ADD COLUMN "recipient" TEXT,
  ADD COLUMN "email_data" JSONB,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "first_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "lease_until" TIMESTAMPTZ(3),
  ADD COLUMN "payload_hash" TEXT;

CREATE UNIQUE INDEX "reminders_deduplication_key_key" ON "reminders" ("deduplication_key");
CREATE INDEX "reminders_status_scheduled_at_idx" ON "reminders" ("status", "scheduled_at");

REVOKE ALL ON "reminders" FROM PUBLIC, anon, authenticated;

COMMIT;
