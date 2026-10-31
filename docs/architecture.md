# Arquitectura

## Estado real

```text
Navegador
   |
   v
Next.js + Material UI (sesion y contexto real; agenda pendiente; /demo estatico)

Express + TypeScript
   |-- GET /health, GET /ready
   |-- Supabase Auth (validacion de token)
   |-- /api/me, /api/onboarding, /api/business
   |-- /api/customers
   |-- /api/services (GET, POST, PATCH /:id)
   |-- /api/appointments/:id/events (lectura)
   |-- /api/appointments/:id/risk/explanation --> Gemini API
   `-- Prisma --> Supabase PostgreSQL
                  |-- modelo multi-tenant
                  |-- migraciones aplicadas
                  `-- RLS habilitado
```

El frontend usa Supabase Auth para login y consume la API en onboarding, negocio, clientes e historial/explicacion de un turno. El dashboard de `/` muestra negocio y total de clientes reales, pero la agenda esta pendiente; `/demo` contiene datos estaticos. Servicios solo tiene API.

| Componente          | Estado                    | Alcance actual                                |
| ------------------- | ------------------------- | --------------------------------------------- |
| Frontend            | Implementado parcialmente | Login, onboarding, clientes                   |
| Backend             | Implementado parcialmente | Identidad, clientes, servicios, historial, IA |
| Prisma              | Implementado              | Schema, Client, migraciones y seed            |
| Supabase PostgreSQL | Configurado y probado     | Persistencia remota                           |
| RLS                 | Implementado              | Politicas por negocio                         |
| Supabase Auth       | Implementado en backend   | Token, perfil y onboarding por API            |
| Gemini              | Implementado en backend   | Explicacion de riesgo bajo demanda            |
| Email               | Planificado               | Sin integracion                               |
| Vercel y Azure      | Planificados              | Sin evidencia de despliegue                   |
| Observabilidad      | Planificada               | Sin implementacion                            |

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

## Seguridad en la API

1. `authenticate` valida el token contra Supabase Auth (`auth.getUser`): cubre firma, vencimiento y usuarios eliminados.
2. `requireProfile` resuelve `businessId` y `role` desde `Profile` (`Profile.id = auth.users.id`).
3. `requirePermission` aplica la matriz de roles de `@turnosmart/shared`.
4. Cada repositorio recibe `businessId`; no existe consulta de un tenant sin ese filtro.
5. Recursos de otro negocio responden 404, igual que los inexistentes, para no revelar su existencia.

Cubierto por `apps/backend/test/unit` y `apps/backend/test/integration/tenant-isolation.test.ts`.

## Onboarding transaccional

`Business` + `Profile(OWNER)` se crean en una transaccion, con el email del usuario de Supabase Auth. Ante requests
concurrentes, la clave primaria de `Profile` (= userId) hace fallar a todos menos uno con `P2002`; esas transacciones
hacen rollback de su negocio y devuelven el ganador. Probado con 5 requests simultaneos contra PostgreSQL.

## Integracion con Gemini (A08)

- Adaptador detras del puerto `LlmClient` (`modules/ai/llm.ts`), intercambiable y testeable con fakes.
- Solo se envian `score`, `level` y factores `{code, label, impact, value}`; `sanitizeFactors` descarta cualquier otro
  campo. Nunca nombres, emails, telefonos ni notas.
- Salida estructurada (`responseJsonSchema`) validada con Zod; un unico reintento solo si el formato es invalido.
- Timeout (`GEMINI_TIMEOUT_MS`), `maxOutputTokens` acotado y limite por usuario (`AI_RATE_LIMIT_*`) en memoria.
  Con mas de una replica, ese limite debera moverse a PostgreSQL.
- Gemini no modifica turnos ni decide estados. Si falla, la agenda y el score siguen operativos.
- La explicacion es transitoria: no se persiste ni requiere cambios de schema.

## Infraestructura

Docker se usa para desarrollo. GitHub Actions provee CI con formato, lint, tipos, tests unitarios y build. El deploy del frontend es manual (`frontend-deploy.yml`, `workflow_dispatch`): Vercel Hobby o Azure Web App; el destino Azure requiere `output: 'standalone'` en Next.js. Vercel, Azure App Service y Application Insights permanecen planificados.

## Modulos planificados

Los contratos propuestos de B01 para servicios, disponibilidad semanal y slots se documentan en
[Contratos de servicios y disponibilidad](api-services-availability.md). Incluyen las dependencias
de autenticacion (A), reservas (C) y las decisiones pendientes de revision; no representan endpoints
implementados en su totalidad. La API de servicios ya esta implementada segun el
[alcance B03](../apps/backend/src/modules/services/README.md); disponibilidad y slots siguen pendientes.

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
