-- El índice único profiles_business_id_email_key no cubre business_id NULL: dos filas ADMIN
-- globales podían compartir email (por ejemplo, al resembrar con otro usuario de Auth).
-- Complementa 20261126000200_platform_roles_and_owner_invitations sin cambiar su modelo.
CREATE UNIQUE INDEX "profiles_admin_email_key"
  ON "profiles" (lower("email"))
  WHERE "business_id" IS NULL;
