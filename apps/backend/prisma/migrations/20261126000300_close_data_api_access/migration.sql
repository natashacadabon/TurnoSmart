-- FINAL-02: cierre de la Data API de Supabase (PostgREST) para el schema public.
--
-- El frontend usa Supabase sólo para Auth; todos los datos del dominio pasan por la API Express,
-- que valida el token, resuelve el negocio desde profiles y conecta con el rol de la base (owner de
-- las tablas). Por eso anon y authenticated no necesitan ningún privilegio sobre public:
-- - Sin GRANT, PostgREST responde 401/403 aunque alguien use la clave pública y un JWT válido.
-- - RLS sigue habilitado en todas las tablas como segunda barrera si un GRANT se reabre por error.
-- - Los privilegios por defecto impiden que una tabla nueva quede expuesta automáticamente.

-- 1. Tablas y secuencias existentes.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- 2. Funciones: ningún RPC público. service_role conserva lo que ya tenía (Cron de recordatorios).
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- 3. Objetos que se creen en el futuro con el rol que ejecuta las migraciones.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- 4. RLS en todas las tablas del dominio (algunas ya lo tenían; es idempotente).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END
$$;

-- 5. Las políticas anteriores asumían acceso directo de miembros por la Data API. Sin GRANT no
-- aplican; se eliminan para que la matriz de acceso tenga una sola fuente de verdad (la API).
DROP POLICY IF EXISTS "business members can read their business" ON public.businesses;
DROP POLICY IF EXISTS "business members can read profiles" ON public.profiles;
DROP POLICY IF EXISTS "business members manage customers" ON public.customers;
DROP POLICY IF EXISTS "business members manage services" ON public.services;
DROP POLICY IF EXISTS "business members manage availability" ON public.availability_rules;
DROP POLICY IF EXISTS "business members manage appointments" ON public.appointments;
DROP POLICY IF EXISTS "business members manage appointment events" ON public.appointment_events;
DROP POLICY IF EXISTS "business members manage risk scores" ON public.risk_scores;
DROP POLICY IF EXISTS "business members manage reminders" ON public.reminders;
