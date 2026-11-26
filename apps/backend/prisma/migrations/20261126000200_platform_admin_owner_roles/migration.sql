-- Modelo definitivo de roles: ADMIN global de la plataforma + OWNER por negocio.
-- STAFF desaparece y ADMIN deja de ser un rol dentro de un negocio.
-- Los perfiles ADMIN/STAFF existentes se conservan (historial y lecturas de notificaciones),
-- pero quedan desactivados como OWNER: no tienen acceso hasta que un ADMIN los reactive.

-- 1. Estado de acceso del OWNER.
ALTER TABLE "profiles"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deactivated_at" TIMESTAMPTZ(3);

UPDATE "profiles"
SET "active" = false,
    "deactivated_at" = CURRENT_TIMESTAMP
WHERE "role" IN ('ADMIN', 'STAFF');

ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_deactivated_at_check"
  CHECK (("active" AND "deactivated_at" IS NULL) OR (NOT "active" AND "deactivated_at" IS NOT NULL));

-- 2. El enum de perfiles sólo admite OWNER.
ALTER TABLE "profiles" ALTER COLUMN "role" DROP DEFAULT;
ALTER TYPE "ProfileRole" RENAME TO "ProfileRole_old";
CREATE TYPE "ProfileRole" AS ENUM ('OWNER');
ALTER TABLE "profiles"
  ALTER COLUMN "role" TYPE "ProfileRole" USING 'OWNER'::"ProfileRole";
ALTER TABLE "profiles" ALTER COLUMN "role" SET DEFAULT 'OWNER';
DROP TYPE "ProfileRole_old";

-- 3. Administradores globales. Se aprovisionan desde código de confianza (seed o script).
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_admins_deactivated_at_check"
      CHECK (("active" AND "deactivated_at" IS NULL) OR (NOT "active" AND "deactivated_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

COMMENT ON TABLE "platform_admins" IS 'Global platform administrators; id matches auth.users.id.';

-- Sin acceso por Data API: sólo el backend (owner de la tabla) lo lee.
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM PUBLIC, anon, authenticated;

-- 4. Un perfil desactivado no resuelve negocio para las políticas RLS.
CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT business_id
  FROM public.profiles
  WHERE id = (SELECT auth.uid())
    AND active
  LIMIT 1
$$;
