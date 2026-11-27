-- ADMIN is a platform role and must not be attached to a business.
-- Existing business ADMIN rows are detached before the new application rules
-- are enforced; their access to operational routes is intentionally removed.

ALTER TABLE "profiles"
  ALTER COLUMN "business_id" DROP NOT NULL;

UPDATE "profiles"
SET "business_id" = NULL
WHERE "role" = 'ADMIN';

ALTER TABLE "notification_reads"
  DROP CONSTRAINT IF EXISTS "notification_reads_profile_id_business_id_fkey";

ALTER TABLE "notification_reads"
  ADD CONSTRAINT "notification_reads_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "profiles_role_business_id_idx"
  ON "profiles" ("role", "business_id");
