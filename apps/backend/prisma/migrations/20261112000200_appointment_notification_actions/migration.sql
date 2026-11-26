BEGIN;

CREATE TYPE "AppointmentConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED');
CREATE TYPE "AppointmentPublicAction" AS ENUM ('CONFIRM', 'CANCEL', 'REQUEST_RESCHEDULE');

ALTER TABLE "businesses"
  ADD COLUMN "booking_email_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reminder_24h_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reminder_48h_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cancellation_email_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reschedule_email_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "customer_cancellation_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "cancellation_minimum_hours" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "businesses_cancellation_minimum_hours_check"
    CHECK ("cancellation_minimum_hours" BETWEEN 0 AND 720);

ALTER TABLE "appointments"
  ADD COLUMN "confirmation_status" "AppointmentConfirmationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "schedule_version" INTEGER NOT NULL DEFAULT 1;

UPDATE "appointments" AS a
SET "confirmation_status" = 'CONFIRMED'
WHERE a.status = 'CONFIRMED'
   OR (a.status IN ('CANCELLED', 'COMPLETED', 'NO_SHOW') AND EXISTS (
     SELECT 1 FROM "appointment_events" AS e
     WHERE e.appointment_id = a.id AND e.business_id = a.business_id AND e.type = 'CONFIRMED'
   ));

ALTER TABLE "appointments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "AppointmentStatus" RENAME TO "AppointmentStatus_old";
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
ALTER TABLE "appointments" ALTER COLUMN "status" TYPE "AppointmentStatus"
  USING (CASE WHEN status::text = 'CONFIRMED' THEN 'SCHEDULED' ELSE status::text END)::"AppointmentStatus";
ALTER TABLE "appointments" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
DROP TYPE "AppointmentStatus_old";

ALTER TYPE "AppointmentEventType" ADD VALUE 'RESCHEDULE_REQUESTED';
ALTER TYPE "AppointmentEventType" ADD VALUE 'RESCHEDULE_REQUEST_DISMISSED';
ALTER TYPE "NotificationKind" ADD VALUE 'RESCHEDULE_REQUESTED';

CREATE TABLE "appointment_public_action_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "action" "AppointmentPublicAction" NOT NULL,
  "recipient" TEXT NOT NULL,
  "schedule_version" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  CONSTRAINT "appointment_public_action_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_public_action_links_appointment_id_business_id_fkey"
    FOREIGN KEY ("appointment_id", "business_id")
    REFERENCES "appointments" ("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "appointment_public_action_links_scope_key"
  ON "appointment_public_action_links"
  ("appointment_id", "business_id", "schedule_version", "action", "recipient");

ALTER TABLE "appointment_public_action_links" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "appointment_public_action_links" FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON "appointments", "appointment_events" FROM PUBLIC, anon, authenticated;

COMMIT;
