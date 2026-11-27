-- OWNER is the only operational role. Existing STAFF profiles are preserved as
-- OWNER because removing the role must not silently delete user accounts.
UPDATE "profiles"
SET "role" = 'OWNER'
WHERE "role" = 'STAFF';

ALTER TABLE "profiles" ALTER COLUMN "role" DROP DEFAULT;

CREATE TYPE "ProfileRole_new" AS ENUM ('OWNER', 'ADMIN');

ALTER TABLE "profiles"
  ALTER COLUMN "role" TYPE "ProfileRole_new"
  USING ("role"::text::"ProfileRole_new");

ALTER TYPE "ProfileRole" RENAME TO "ProfileRole_old";
ALTER TYPE "ProfileRole_new" RENAME TO "ProfileRole";
DROP TYPE "ProfileRole_old";

ALTER TABLE "profiles"
  ALTER COLUMN "role" SET DEFAULT 'OWNER';

ALTER TABLE "profiles"
  DROP CONSTRAINT IF EXISTS "profiles_role_business_consistency";

ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_role_business_consistency"
  CHECK (
    ("role" = 'ADMIN' AND "business_id" IS NULL)
    OR ("role" = 'OWNER' AND "business_id" IS NOT NULL)
  );

ALTER TABLE "businesses"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "profiles"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "OwnerInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "owner_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "full_name" TEXT,
  "token_hash" TEXT NOT NULL,
  "status" "OwnerInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "owner_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "owner_invitations_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "owner_invitations_token_hash_key"
  ON "owner_invitations" ("token_hash");
CREATE INDEX "owner_invitations_business_id_status_idx"
  ON "owner_invitations" ("business_id", "status");
CREATE INDEX "owner_invitations_email_status_idx"
  ON "owner_invitations" ("email", "status");
