# Backend - TurnoSmart

API REST del sistema TurnoSmart, encargada de gestionar la lógica de negocio, la autenticación, la disponibilidad, los turnos y la integración con servicios externos.
Backend construido con Node.js, Express y TypeScript.

## Descripción general

El backend es la capa central de la aplicación. Su alcance objetivo incluye:

- Autenticación y perfiles de usuarios
- Gestión de negocios, servicios y clientes
- Turnos, disponibilidad y eventos
- Cálculo de riesgo de no-show
- Recordatorios por email
- Integración con Gemini para recomendaciones inteligentes

## Stack

- Node.js 22, Express 5 y TypeScript
- Prisma ORM sobre Supabase PostgreSQL
- Supabase Auth (validación de tokens)
- Zod para entorno y entradas
- Gemini API (`@google/genai`)
- helmet y cors
- Vitest y Supertest

## Estado actual

Implementado:

- app Express testeable (`src/app.ts`) separada del arranque (`src/index.ts`);
- `GET /health` y `GET /ready` (este ultimo consulta PostgreSQL);
- CORS por lista de origenes, helmet, `X-Request-Id`, logs JSON y errores uniformes sin stack;
- validacion de entorno y de entradas con Zod (contratos en `@turnosmart/shared`);
- autenticacion con Supabase Auth, contexto de negocio desde `Profile` y permisos por rol;
- identidad: `GET /api/me`, `POST /api/onboarding`, `PATCH /api/business`;
- clientes: `GET/POST /api/customers`, `GET/PATCH/DELETE /api/customers/:id` (la baja es solo para OWNER/ADMIN y responde 409 si el cliente tiene turnos);
- servicios: `GET/POST /api/services`, `PATCH /api/services/:id` (desactivacion con `active: false`, sin borrado fisico);
- historial: `GET /api/appointments/:id/events` (solo lectura);
- explicacion de riesgo con Gemini: `POST /api/appointments/:id/risk/explanation`;
- Prisma Client, esquema multi-tenant, migraciones, RLS y seed idempotente.

Pendiente: disponibilidad, horarios libres, reservas, cálculo del score, email y observabilidad. El [alcance de servicios](src/modules/services/README.md) documenta lo implementado y sus limites.

Contratos y codigos de error: [docs/contracts.md](../../docs/contracts.md).

## Variables

El backend carga `apps/backend/.env` (plantilla: `.env.example` en la raíz; la tabla de variables está en el README de la raíz). `DATABASE_URL` se usa en runtime y `DIRECT_URL` en migraciones. Si falta una variable obligatoria, el proceso termina al arrancar sin mostrar valores.

## Comandos

```bash
npm run dev:backend
npm run build --workspace=@turnosmart/backend
npm run typecheck --workspace=@turnosmart/backend
npm run test --workspace=@turnosmart/backend
npm run test:integration --workspace=@turnosmart/backend
npm run prisma:validate --workspace=@turnosmart/backend
npm run prisma:generate --workspace=@turnosmart/backend
npm run prisma:migrate --workspace=@turnosmart/backend
npm run prisma:seed --workspace=@turnosmart/backend
npm run prisma:studio --workspace=@turnosmart/backend
```

`prisma:migrate` aplica migraciones existentes mediante `prisma migrate deploy`. `build` y `typecheck` generan el cliente de Prisma antes de compilar solo si falta o si cambió el schema (`scripts/ensure-prisma-client.mjs`): funcionan después de un `npm ci` y también con `dev:backend` corriendo, que en Windows bloquea el motor de Prisma.

`test` corre los tests unitarios (fakes en memoria, sin DB). `test:integration` necesita `DATABASE_URL` apuntando a una base con las migraciones aplicadas (Supabase local o una base descartable); crea negocios de prueba y los borra al terminar. Nunca correrlo contra la base del equipo ni la de la demo.

## Modelo y seguridad

- `20260922000100_init_turnosmart`: tablas, enums, relaciones, indices y constraints.
- `20260922000200_enable_rls`: permisos y politicas RLS.

`Profile.id` debe coincidir con `auth.users.id`. El onboarding crea `Business` y `Profile(OWNER)` en una transaccion desde el backend, con el email de Supabase Auth; repetirlo o enviarlo en paralelo no crea otro negocio.

Prisma se conecta con un rol que omite RLS: el aislamiento entre negocios lo garantiza el filtro por `businessId` en cada repositorio, cubierto por tests unitarios y de integracion.

`/health` confirma el proceso HTTP; `/ready` ademas confirma la conexion con PostgreSQL.

## Arquitectura

La API se organiza en módulos (`identity`, `customers`, `services`, `events`, `ai`), cada uno con sus rutas y un repositorio que concentra el acceso a datos con Prisma. `createApp` recibe las dependencias, por eso los tests reemplazan Supabase, la base y Gemini por fakes. Las entradas se validan con los schemas de `@turnosmart/shared`.

Cada request autenticado pasa por `authenticate` (token de Supabase), `requireProfile` (negocio y rol desde `Profile`) y, según la ruta, `requirePermission`. El negocio nunca se toma del body: todas las consultas filtran por el `businessId` del perfil.

## Integraciones

- **Supabase Auth:** valida el token de cada request; `Profile.id` coincide con el usuario de Auth.
- **Gemini:** explica el score de un turno a pedido. Solo recibe el score, el nivel y los factores, nunca nombres, emails, teléfonos ni notas. La respuesta se valida con Zod, tiene timeout y límite por usuario; si Gemini falla, la agenda y el score siguen funcionando.

Previstas: proveedor de email para recordatorios, Azure App Service para desplegar la API y Application Insights o Azure Monitor para logs y métricas.

Gemini no reemplaza el score heurístico ni toma decisiones operativas.

## Estructura

```text
apps/backend/
├── src/
│   ├── index.ts          # Arranque: entorno, Prisma, listen y shutdown
│   ├── app.ts            # createApp(deps): middlewares y rutas, sin listen
│   ├── config/env.ts     # Validacion de variables con Zod
│   ├── lib/              # Errores, helpers HTTP, logger, verificador de Supabase
│   ├── middleware/       # requestId, errores, authenticate, requireProfile, permisos
│   ├── modules/          # identity, customers, services, events, ai (routes + repository)
│   └── types/            # Extension de Express.Request
├── test/
│   ├── fakes.ts          # Repositorios en memoria y verificador de tokens falso
│   ├── unit/             # supertest contra createApp con fakes
│   └── integration/      # Contra PostgreSQL real
├── prisma/               # Schema, migraciones y seed
├── tsconfig.json         # Typecheck de src y test
└── tsconfig.build.json   # Build de src a dist/
```

## Convenciones esperadas

- Usar TypeScript en toda la API
- Validar entradas con Zod
- Mantener separación entre rutas y repositorios por módulo
- Centralizar configuración en variables de entorno
- Documentar endpoints y respuestas según evolucione la API
- Mantener la lógica de negocio limpia y reutilizable

## Próximos pasos

- Disponibilidad y horarios libres
- Reservas, reprogramaciones y cancelaciones con prevención de solapamientos
- Cálculo del score de riesgo de no-show
- Recordatorios por email
- Despliegue en Azure App Service y observabilidad

## Contribución

1. Crear una rama para la funcionalidad o corrección.
2. Desarrollar el cambio con commits claros.
3. Validar compilación y lint.
4. Abrir un pull request con una descripción del cambio.

## Recursos útiles

- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [Prisma](https://www.prisma.io/)
- [Supabase](https://supabase.com/)
- [Gemini API](https://ai.google.dev/)
