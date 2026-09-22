# Infraestructura

## Implementado

- `docker/Dockerfile.dev` compartido por los workspaces.
- `docker/compose.dev.yml` con frontend y backend.
- Puertos `3000` y `4000`, hot reload y volumen de dependencias.
- Cache de Next.js y carga de `apps/backend/.env` mediante `env_file`.
- Supabase cloud como base remota; no hay PostgreSQL local en Compose.

```bash
npm run docker:dev
npm run docker:down
```

El frontend usa `NEXT_PUBLIC_API_URL=http://localhost:4000` porque el navegador accede al puerto publicado.

## Planificado

- Vercel para frontend.
- Azure App Service para backend.
- Gestion de secretos por ambiente.
- Azure Monitor o Application Insights.
- Imagenes y pipeline de produccion.

No existe actualmente infraestructura como codigo, CD ni evidencia versionada de recursos activos en Vercel o Azure.

## Plan de evolucion

1. Separar ambientes de desarrollo y produccion.
2. Desplegar el frontend en Vercel.
3. Preparar una imagen de produccion para el backend.
4. Desplegar la API en Azure App Service.
5. Gestionar secretos fuera del repositorio.
6. Incorporar health checks, logs estructurados y metricas.
7. Agregar CD luego de validar manualmente cada destino.

La configuracion de desarrollo no debe reutilizarse como imagen de produccion sin hardening.
