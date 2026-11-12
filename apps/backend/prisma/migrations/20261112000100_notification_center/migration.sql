CREATE TYPE "NotificationKind" AS ENUM (
  'APPOINTMENT_UPCOMING', 'CONFIRMED', 'CANCELLED', 'RESCHEDULED', 'MARKED_NO_SHOW', 'COMPLETED'
);

CREATE UNIQUE INDEX "profiles_id_business_id_key" ON "profiles" ("id", "business_id");

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "appointment_id" UUID,
  "kind" "NotificationKind" NOT NULL,
  "source_key" TEXT NOT NULL,
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_business_id_fkey" FOREIGN KEY ("business_id")
    REFERENCES "businesses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notifications_appointment_id_fkey" FOREIGN KEY ("appointment_id")
    REFERENCES "appointments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "notifications_business_id_source_key_key"
  ON "notifications" ("business_id", "source_key");
CREATE UNIQUE INDEX "notifications_id_business_id_key" ON "notifications" ("id", "business_id");
CREATE INDEX "notifications_business_recent_idx"
  ON "notifications" ("business_id", "created_at" DESC, "id" DESC);
CREATE INDEX "notifications_appointment_id_idx" ON "notifications" ("appointment_id");

CREATE TABLE "notification_reads" (
  "business_id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "profile_id" UUID NOT NULL,
  "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("notification_id", "profile_id"),
  CONSTRAINT "notification_reads_notification_id_business_id_fkey"
    FOREIGN KEY ("notification_id", "business_id")
    REFERENCES "notifications" ("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_reads_profile_id_business_id_fkey"
    FOREIGN KEY ("profile_id", "business_id")
    REFERENCES "profiles" ("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "notification_reads_profile_idx"
  ON "notification_reads" ("business_id", "profile_id", "notification_id");
CREATE INDEX "notification_reads_profile_id_business_id_idx"
  ON "notification_reads" ("profile_id", "business_id");

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications, public.notification_reads FROM PUBLIC, anon, authenticated;
