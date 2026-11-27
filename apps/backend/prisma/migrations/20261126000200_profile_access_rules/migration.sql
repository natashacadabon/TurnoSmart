-- Reglas de acceso sobre el modelo de 20261126000100_global_platform_admin:
-- ADMIN global con business_id NULL, OWNER por negocio y STAFF sólo como legado.

-- 1. Estado de acceso: un perfil inactivo conserva historial y lecturas, pero no entra.
ALTER TABLE "profiles"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deactivated_at" TIMESTAMPTZ(3);

-- STAFF ya no tiene permisos: queda desactivado explícitamente.
UPDATE "profiles"
SET "active" = false,
    "deactivated_at" = CURRENT_TIMESTAMP
WHERE "role" = 'STAFF';

ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_deactivated_at_check"
  CHECK (("active" AND "deactivated_at" IS NULL) OR (NOT "active" AND "deactivated_at" IS NOT NULL));

-- 2. La base garantiza la regla de roles: sólo el ADMIN global no tiene negocio.
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_role_business_check"
  CHECK (("role" = 'ADMIN') = ("business_id" IS NULL));

-- profiles_business_id_email_key no cubre business_id NULL: un email ADMIN es único aparte.
CREATE UNIQUE INDEX "profiles_admin_email_key"
  ON "profiles" ("email")
  WHERE "business_id" IS NULL;

-- 3. Sólo un OWNER activo resuelve negocio para las políticas RLS.
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
    AND role = 'OWNER'
    AND active
  LIMIT 1
$$;
