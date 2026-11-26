# TurnoSmart

TurnoSmart es un proyecto académico de SaaS para negocios que atienden con turnos. El personal administra clientes, servicios y disponibilidad, opera la agenda y consulta el riesgo de inasistencia de cada turno. Los clientes pueden gestionar una reserva existente desde los enlaces de correo.

## Estado del repositorio

La descripción corresponde al código actual del repositorio. La activación y las pruebas en cada entorno publicado se registran por separado en el [backlog](docs/backlog.md).

| Área                 | Funcionalidad disponible en el código                                                                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidad y clientes | Inicio y cierre de sesión con Supabase Auth, onboarding del negocio, roles OWNER/ADMIN/STAFF, configuración de nombre y zona horaria, alta, edición, búsqueda y baja de clientes sin turnos.                                                                      |
| Servicios y horarios | Catálogo con búsqueda, estados y paginación local; disponibilidad semanal visual con edición en modal y consulta de slots colapsable. Cada negocio tiene una agenda y una grilla de comienzos cada 15 minutos desde la apertura de cada franja.                   |
| Agenda y turnos      | Vistas de día, semana y mes, alta, edición de notas, confirmación, cancelación, reprogramación, cierre, registro de ausencias e historial. La API vuelve a validar el horario dentro de la transacción.                                                           |
| Riesgo               | Score heurístico persistido y explicación bajo demanda con Gemini cuando se configura su clave.                                                                                                                                                                   |
| Notificaciones       | Campana fija en las pantallas privadas, lecturas por perfil y actualización automática de agenda con toasts. Correos transaccionales, hasta tres recordatorios configurables y enlaces para confirmar, cancelar o solicitar un cambio con aprobación del negocio. |
| Operación            | Docker Compose local, checks de GitHub Actions, configuración de Vercel y Render y artefactos para un despliegue manual del backend en Azure. La API expone health, readiness y métricas en memoria.                                                              |

La instalación limpia de migraciones y las suites locales ya se verificaron; los resultados están en la [guía de pruebas](tests/README.md#validación-local-del-25-de-noviembre-de-2026). Queda por validar el recorrido completo en el entorno publicado con su base migrada, Resend y Supabase Cron. El [backlog](docs/backlog.md) detalla además la cobertura pendiente en CI, el endurecimiento de permisos de la Data API y las capacidades previstas fuera del alcance actual.

## Stack y estructura

| Directorio         | Responsabilidad                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `apps/frontend/`   | Next.js 16, React 19, Material UI, FullCalendar y pruebas Playwright.                                         |
| `apps/backend/`    | Node.js 22, Express 5, Prisma 6.12, PostgreSQL, Supabase Auth, Gemini, correo y pruebas con Vitest/Supertest. |
| `packages/shared/` | Tipos, esquemas Zod y códigos de error compartidos.                                                           |
| `infra/`           | Docker Compose, guías de Vercel y Render, Bicep y empaquetado para Azure, y SQL de Supabase Cron.             |
| `docs/`            | Arquitectura, contratos, operación, costos y backlog.                                                         |

## Desarrollo local con Docker

Requiere Node.js 22, npm y Docker Desktop con contenedores Linux. Ejecutar desde la raíz Git:

```sh
npm ci
npm run docker:dev
```

Abrir `http://localhost:3000/login`. La cuenta de prueba es `admin@turnosmart.test`, con la contraseña local indicada en la [guía de infraestructura](infra/README.md) o la configurada con `TS_SEED_PASSWORD` al crear la cuenta. Docker levanta PostgreSQL y Supabase Auth locales, aplica las migraciones y carga los datos de prueba. Ambas apps corren en el host con recarga en desarrollo.

## Desarrollo con un proyecto de Supabase

1. Ejecutar `npm ci` con Node.js 22 desde la raíz Git.
2. Copiar [la plantilla raíz](.env.example) a `apps/backend/.env` y [la plantilla del frontend](apps/frontend/.env.example) a `apps/frontend/.env.local`. Usar el mismo proyecto Supabase en ambas apps.
3. En el backend, completar `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, `DIRECT_URL` y `CORS_ORIGIN=http://localhost:3000`. Para Supabase Cloud, usar el pooler transaccional (6543, con `?pgbouncer=true`) para la API y conexión directa o pooler de sesión (5432) para migraciones. Codificar los caracteres especiales de la contraseña en las URLs.
4. En el frontend, completar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` con la URL y la clave pública del mismo proyecto. `next dev` usa la API en `http://localhost:4000`. Los builds requieren además los dos orígenes HTTPS públicos de la plantilla, incluso si uno está inactivo.
5. Generar el cliente y aplicar las migraciones al entorno elegido:

```sh
npm run prisma:generate --workspace=apps/backend
npm run prisma:migrate --workspace=apps/backend
```

6. Crear y confirmar un usuario desde Supabase Auth para completar el onboarding como OWNER. También se puede usar el [seed de desarrollo](apps/backend/prisma/README.md) con una base autorizada.
7. En terminales separadas, ejecutar `npm run dev:backend` y `npm run dev:frontend`. Ambos comandos compilan `packages/shared`.

Configurar `GEMINI_API_KEY` para habilitar las explicaciones. La [guía de operación](docs/operations.md#notificaciones-de-turnos) cubre los modos de correo, los enlaces firmados y el cron. Las claves privadas se configuran en el backend o en los almacenes de secretos del entorno.

| Ruta                                                     | Uso                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/login`, `/onboarding`                                  | Acceso y alta inicial del negocio.                                              |
| `/`, `/appointments/[id]`                                | Agenda y detalle de turno.                                                      |
| `/customers`, `/services`, `/settings`, `/notifications` | Clientes, servicios y disponibilidad, configuración y centro de notificaciones. |
| `/turno/gestionar`                                       | Página pública que requiere un enlace válido para operar sobre un turno.        |
| API `/health`, `/ready`, `/metrics`                      | Estado del proceso, conectividad a PostgreSQL y métricas de la instancia.       |

Si `/ready` devuelve 503, revisar la conexión de la API a PostgreSQL. Si el backend registra `P2021`, comprobar las migraciones. Si el navegador bloquea la API por CORS, comprobar el origen exacto en `CORS_ORIGIN`.

## Pruebas y despliegue

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:config --workspace=apps/frontend
```

GitHub Actions valida pushes a `dev` y `main` y PRs hacia ambas ramas. También valida el schema Prisma y compila las dos apps. Las pruebas de integración con PostgreSQL y las pruebas de navegador tienen comandos y requisitos propios. [Guía de pruebas](tests/README.md)

Para configurar Preview o Production y comprobar el backend seleccionado, consultar [Vercel](infra/vercel/README.md) y [Render](infra/render/README.md). El procedimiento de Azure vive en su [guía de infraestructura](infra/azure/README.md).

## Documentación

- [Arquitectura](docs/architecture.md)
- [Contratos generales de la API](docs/contracts.md) y [servicios, disponibilidad y slots](docs/api-services-availability.md)
- [Operación y recorrido de demo](docs/operations.md)
- [Notificaciones de turnos](docs/notifications-plan.md)
- [Backlog](docs/backlog.md) y [costos](docs/costs.md)
- [Backend](apps/backend/README.md), [frontend](apps/frontend/README.md) y [contratos compartidos](packages/shared/README.md)
- [Registro de decisiones asistidas por IA](AI-DECISIONS.md) y [auditoría histórica](docs/repository-audit.md)

## Contribución

Usar ramas `feat/<tema>`, `fix/<tema>` o `chore/<tema>` desde `dev` y abrir PR hacia `dev`. Integrar a `main` mediante PR para las entregas. Usar Conventional Commits. Husky ejecuta lint-staged en pre-commit, Commitlint en commit-msg y typecheck en pre-push.
