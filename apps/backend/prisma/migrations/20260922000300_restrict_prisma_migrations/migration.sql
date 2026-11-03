-- Restringir el acceso a la tabla interna de Prisma.
REVOKE ALL ON TABLE public._prisma_migrations
FROM anon, authenticated;

-- Activar RLS sin crear políticas públicas.
ALTER TABLE public._prisma_migrations
ENABLE ROW LEVEL SECURITY;
