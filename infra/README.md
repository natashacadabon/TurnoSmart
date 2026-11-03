# Infraestructura

## Implementado

- `docker/Dockerfile.dev` compartido por los workspaces.
- `docker/compose.dev.yml` con frontend y backend.
- Puertos `3000` y `4000`, hot reload y volumen de dependencias.
- Cache de Next.js y carga de `apps/backend/.env` mediante `env_file`.
- Supabase cloud como base remota; no hay PostgreSQL local en Compose.
- Al arrancar, el backend genera el cliente de Prisma y ambos servicios compilan `packages/shared`, que no forma parte de la imagen.

```bash
npm run docker:dev
npm run docker:down
```

En `next dev`, el frontend usa `http://localhost:4000`, el puerto del backend
publicado en el host; no hace falta definir una URL de API local. Las variables
de Supabase del frontend se leen de `apps/frontend/.env.local`, montado en el
contenedor. Los builds de produccion exigen origenes HTTPS publicos.

- GitHub Actions valida pushes y PRs. [Vercel](vercel/README.md) publica Preview y Production desde Actions. [Render Dev](render/README.md) publica desde `dev` tras los checks de GitHub.

## Planificado

B07 M1–M2 preparado en [azure/README.md](azure/README.md): Bicep de RG temporal,
Plan F1 Linux/App Service Node 22, ZIP de produccion y comandos PowerShell manuales.
No se crearon recursos Azure; B1 requiere aprobacion explicita. La demo exige
preflight/what-if, despliegue manual y limpieza del RG.

- Azure App Service para backend.
- Gestion de secretos por ambiente.
- Azure Monitor o Application Insights.
- Imagenes y pipeline de produccion.

La infraestructura como codigo de Azure se reserva para checkpoints temporales.

## Plan de evolucion

1. Separar ambientes de desarrollo y produccion.
2. Activar CD en Vercel y Render con los servicios existentes.
3. Preparar una imagen de produccion para el backend.
4. Desplegar la API en Azure App Service.
5. Gestionar secretos fuera del repositorio.
6. Incorporar health checks, logs estructurados y metricas.

La configuracion de desarrollo no debe reutilizarse como imagen de produccion sin hardening.
