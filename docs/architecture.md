# Arquitectura

## Estado real

```text
Navegador
   |
   v
Next.js + Material UI (dashboard con datos estaticos)

Express + TypeScript
   |-- GET /health
   `-- Prisma --> Supabase PostgreSQL
                  |-- modelo multi-tenant
                  |-- migraciones aplicadas
                  `-- RLS habilitado
```

Frontend y backend pueden ejecutarse juntos con Docker, pero aun no estan integrados mediante HTTP.

| Componente          | Estado                    | Alcance actual                     |
| ------------------- | ------------------------- | ---------------------------------- |
| Frontend            | Implementado parcialmente | Dashboard demostrativo             |
| Backend             | Implementado parcialmente | Servidor y health check            |
| Prisma              | Implementado              | Schema, Client, migraciones y seed |
| Supabase PostgreSQL | Configurado y probado     | Persistencia remota                |
| RLS                 | Implementado              | Politicas por negocio              |
| Supabase Auth       | Planificado               | Sin login ni onboarding            |
| Gemini y email      | Planificados              | Sin integraciones                  |
| Vercel y Azure      | Planificados              | Sin evidencia de despliegue        |
| Observabilidad      | Planificada               | Sin implementacion                 |

## Arquitectura objetivo

```text
Usuario
  |
  | HTTPS
  v
Next.js en Vercel
  |
  | REST/JSON + token de Supabase Auth
  v
Express en Azure App Service
  |-- Prisma --> Supabase PostgreSQL
  |-- Supabase Auth
  |-- Gemini API
  `-- Proveedor de email
```

La arquitectura objetivo no implica que esos servicios esten desplegados actualmente.

## Multi-tenancy

- `Business` es la raiz del tenant.
- Las entidades operativas incluyen `businessId`.
- Las relaciones compuestas impiden referencias entre negocios.
- RLS usa `auth.uid()` y `Profile.id` para resolver el tenant.
- `anon` no posee permisos sobre las tablas de dominio.
- El alta inicial de negocio y perfil debe realizarse desde backend confiable.
- El backend debe filtrar por `businessId` aunque Prisma use un rol que omita RLS.

## Infraestructura

Docker se usa para desarrollo. GitHub Actions provee CI con formato, lint, tipos y build. No existe CD configurado. Vercel, Azure App Service y Application Insights permanecen planificados.

## Modulos planificados

- autenticacion y perfiles;
- negocios, servicios y clientes;
- disponibilidad, turnos y eventos;
- riesgo de no-show;
- recordatorios y reportes.

## Evolucion posterior al MVP

- lista de espera y sugerencias para cubrir huecos;
- recordatorios por WhatsApp;
- pagos o senas;
- analitica avanzada y umbrales configurables.

Estas capacidades no forman parte del estado actual ni son requisitos de implementacion del Checkpoint 1.
