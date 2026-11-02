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

- GitHub Actions: CI en pushes y pull requests, y deploy manual del frontend en Vercel/Azure (`frontend-deploy.yml`, ver README de la raiz).

## Planificado

B07 M1–M2 preparado en [azure/README.md](azure/README.md): Bicep de RG temporal,
Plan F1 Linux/App Service Node 22, ZIP de produccion y comandos PowerShell manuales.
No se crearon recursos Azure; B1 requiere aprobacion explicita. El frontend y los
workflows existentes no cambian. La demo exige preflight/what-if y limpieza del RG.

- Azure App Service para backend.
- Gestion de secretos por ambiente.
- Azure Monitor o Application Insights.
- Imagenes y pipeline de produccion.

Existe infraestructura como codigo para el backend, sin CD automatico ni despliegue
Azure realizado por B07. El frontend se despliega en Vercel solo a mano, desde el workflow.

## Plan de evolucion

1. Separar ambientes de desarrollo y produccion.
2. Desplegar el frontend en Vercel (workflow manual preparado).
3. Preparar una imagen de produccion para el backend.
4. Desplegar la API en Azure App Service.
5. Gestionar secretos fuera del repositorio.
6. Incorporar health checks, logs estructurados y metricas.
7. Agregar CD luego de validar manualmente cada destino.

La configuracion de desarrollo no debe reutilizarse como imagen de produccion sin hardening.
