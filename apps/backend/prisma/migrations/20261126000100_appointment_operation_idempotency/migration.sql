ALTER TABLE "appointment_events"
  ADD COLUMN "operation_key" TEXT;

CREATE UNIQUE INDEX "appointment_events_business_operation_key_key"
  ON "appointment_events" ("business_id", "operation_key");
