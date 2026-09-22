# TurnoSmart

TurnoSmart es una plataforma SaaS para la gestion inteligente de turnos en pequenos y medianos negocios. Combina una agenda online con analisis de riesgo de no-show para ayudar a reducir ausencias sin aviso, cancelaciones tardias y huecos dificiles de cubrir.

El proyecto fue pensado para negocios con atencion por reserva, como peluquerias, centros de estetica, consultorios, estudios y servicios profesionales.

## Problema

Los negocios que trabajan con turnos pierden tiempo e ingresos cuando los clientes no asisten, cancelan tarde o dejan espacios libres en la agenda. Las agendas tradicionales permiten registrar reservas, pero no aprovechan el historial de clientes para anticipar riesgos ni ayudar a tomar mejores decisiones operativas.

## Propuesta de valor

TurnoSmart permite administrar turnos, clientes, servicios y recordatorios desde un unico lugar. Su diferencial es un score de riesgo de no-show por turno, calculado a partir de reglas explicables y complementado con recomendaciones generadas por IA.

Con esta informacion, el negocio puede:

- identificar turnos con mayor probabilidad de ausencia;
- reforzar recordatorios para clientes de riesgo;
- priorizar confirmaciones antes de horarios criticos;
- mejorar la ocupacion de la agenda;
- reducir capacidad ociosa.

## Usuarios objetivo

- Negocios con atencion por turnos.
- Personal administrativo que organiza agenda, clientes, servicios y recordatorios.
- Clientes finales que necesitan reservar, cancelar o reprogramar de forma simple.

## Estado actual

El proyecto se encuentra en la etapa de arquitectura y preparacion tecnica del piloto.

### Implementado

- Monorepo con npm workspaces.
- Frontend Next.js, React, TypeScript y Material UI con un dashboard demostrativo.
- Backend Express y TypeScript con endpoint `GET /health`.
- Modelo PostgreSQL multi-tenant con Prisma.
- Migraciones iniciales y politicas RLS para Supabase.
- Seeder idempotente con datos demostrativos.
- Docker Compose de desarrollo para frontend y backend.
- CI con formato, lint, typecheck y build.
- Git hooks con Husky, lint-staged y Commitlint.

### Configurado, sin flujo funcional completo

- Supabase PostgreSQL como base remota.
- Aislamiento por `businessId`, claves foraneas compuestas y RLS.
- Variables para Supabase Auth, Gemini y email.

### Planificado

- Autenticacion y onboarding con Supabase Auth.
- API REST de negocios, clientes, servicios, disponibilidad y turnos.
- Integracion entre frontend y backend.
- Calculo de riesgo y recomendaciones con Gemini.
- Recordatorios por email.
- Despliegue del frontend en Vercel y del backend en Azure App Service.
- Observabilidad con Azure Monitor o Application Insights.

No existe evidencia versionada de despliegues en Vercel o Azure. Esos servicios forman parte de la arquitectura objetivo, no del estado implementado.

## Stack real

| Capa            | Implementado                                               | Planificado                        |
| --------------- | ---------------------------------------------------------- | ---------------------------------- |
| Frontend        | Next.js 16, React 19, TypeScript, Material UI, CSS Modules | Formularios, fetching y calendario |
| Backend         | Node.js, Express, TypeScript                               | API REST modular y validacion      |
| Datos           | Supabase PostgreSQL, Prisma, migraciones, seed y RLS       | Pruebas de aislamiento             |
| IA              | Modelo de scores                                           | Gemini para explicaciones          |
| Infraestructura | Docker, Compose y GitHub Actions                           | Vercel, Azure y observabilidad     |

## Stack objetivo del piloto

Ademas de lo ya instalado, el plan contempla React Hook Form y Zod para formularios, TanStack Query para estado remoto, FullCalendar para la agenda, Supabase Auth, Gemini API, email, Vercel, Azure App Service y observabilidad con Azure Monitor o Application Insights.

Estas tecnologias forman parte de la direccion aprobada, pero se incorporaran solo cuando el sprint correspondiente las necesite.

## Estructura

```text
apps/frontend/       Aplicacion Next.js
apps/backend/        API Express y Prisma
packages/shared/     Tipos compartidos iniciales
docs/                Arquitectura y backlog
infra/docker/        Docker de desarrollo
tests/               Estrategia de pruebas pendiente
.github/workflows/   Integracion continua
AI-DECISIONS.md      Decisiones asistidas por IA
```

## Requisitos y configuracion

- Node.js 22.
- npm.
- Docker Desktop, opcional.
- Proyecto de Supabase.

```bash
npm ci
```

Crear `apps/backend/.env` usando `.env.example`. Para Prisma se requieren `DATABASE_URL` en runtime y `DIRECT_URL` para migraciones. Los `.env` estan ignorados por Git. `SUPABASE_SERVICE_ROLE_KEY` es exclusiva del backend.

```bash
npm run prisma:validate --workspace=@turnosmart/backend
npm run prisma:generate --workspace=@turnosmart/backend
npm run prisma:migrate --workspace=@turnosmart/backend
npm run prisma:seed --workspace=@turnosmart/backend
```

El seed no crea usuarios ficticios. Para asociarlo con Supabase Auth se configura `SEED_AUTH_USER_ID` con un usuario existente.

## Desarrollo

```bash
npm run dev:frontend
npm run dev:backend
```

Frontend: `http://localhost:3000`

Backend: `http://localhost:4000/health`

Con Docker:

```bash
npm run docker:dev
```

Compose no crea PostgreSQL local: utiliza Supabase cloud.

## Calidad y CI

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
```

GitHub Actions ejecuta estos controles en pushes y pull requests hacia `dev` y `main`. No existe CD configurado.

## Datos y multi-tenancy

El esquema incluye `Business`, `Profile`, `Customer`, `Service`, `AvailabilityRule`, `Appointment`, `AppointmentEvent`, `RiskScore` y `Reminder`.

Las entidades operativas incluyen `businessId`. Las relaciones compuestas evitan referencias entre tenants y RLS protege el acceso desde Supabase. Como una conexion Prisma propietaria puede omitir RLS, el backend tambien debera filtrar por negocio.

## Alcance planificado del MVP

- Autenticacion, perfiles y alta de negocio.
- CRUD de servicios y clientes.
- Reglas de disponibilidad y agenda diaria/semanal.
- Creacion, reprogramacion y cancelacion de turnos.
- Historial de eventos y estados.
- Score heuristico de riesgo de no-show.
- Recordatorios por email segun riesgo.
- Explicaciones y recomendaciones asistidas por Gemini.

Lista de espera, WhatsApp, pagos o senas y analitica avanzada quedan fuera del MVP inicial.

## Identidad visual

La identidad visual propuesta es SaaS profesional, moderna y limpia, apta para rubros como estetica, salud, consultoria y servicios profesionales.

| Uso                        | Color          | Hex       |
| -------------------------- | -------------- | --------- |
| Primario                   | Indigo         | `#4F46E5` |
| Primario hover             | Indigo oscuro  | `#4338CA` |
| Secundario / IA            | Violeta        | `#8B5CF6` |
| Exito / confirmado         | Verde          | `#22C55E` |
| Advertencia / riesgo medio | Ambar          | `#F59E0B` |
| Error / riesgo alto        | Rojo           | `#EF4444` |
| Fondo                      | Gris muy claro | `#F8FAFC` |
| Cards                      | Blanco         | `#FFFFFF` |
| Texto principal            | Slate          | `#0F172A` |
| Texto secundario           | Slate gris     | `#64748B` |
| Bordes                     | Gris           | `#E2E8F0` |

## Plan de desarrollo

1. **Sprint 0:** setup, CI, entornos, arquitectura y datos.
2. **Sprint 1:** autenticacion, onboarding, perfiles y layout.
3. **Sprint 2:** servicios, clientes y disponibilidad.
4. **Sprint 3:** agenda, turnos y eventos.
5. **Sprint 4:** calculo y visualizacion del riesgo.
6. **Sprint 5:** recordatorios y trazabilidad.
7. **Sprint 6:** explicaciones y recomendaciones con Gemini.
8. **Sprint 7:** UX, errores, metricas, pruebas, documentacion y despliegue.

El detalle de prioridades se mantiene en [docs/backlog.md](docs/backlog.md).

## Documentacion

- [Arquitectura](docs/architecture.md)
- [Backlog](docs/backlog.md)
- [Decisiones de IA](AI-DECISIONS.md)
- [Backend](apps/backend/README.md)
- [Frontend](apps/frontend/README.md)
- [Infraestructura](infra/README.md)
- [Pruebas](tests/README.md)
