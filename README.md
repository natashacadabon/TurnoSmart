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

### Implementado

- Monorepo con npm workspaces y contratos compartidos (`@turnosmart/shared`) entre frontend y backend.
- Inicio y cierre de sesion con Supabase Auth; la sesion se recupera al recargar.
- Onboarding: una cuenta nueva crea su negocio y queda como OWNER. Roles OWNER, ADMIN y STAFF con permisos aplicados en la API.
- Clientes: alta, consulta, edicion, baja (OWNER y ADMIN; no se puede eliminar un cliente con turnos), listado paginado y busqueda por nombre, email o telefono.
- Configuracion del negocio (nombre y zona horaria).
- Historial de eventos de un turno y explicacion del riesgo con Gemini, bajo demanda.
- Agenda con el diseño del dashboard y datos reales del negocio; dashboard de ejemplo en `/demo`.
- Aislamiento entre negocios en la API (cada consulta filtra por `businessId`) y RLS en la base.
- Errores uniformes en la API y pantalla de error recuperable en el frontend.
- Modelo PostgreSQL multi-tenant con Prisma, migraciones, RLS y seed idempotente.
- Pruebas unitarias, de integracion con PostgreSQL y end-to-end con Playwright.
- CI con formato, lint, typecheck, tests unitarios y build; deploy manual del frontend.
- Docker Compose de desarrollo y Git hooks con Husky, lint-staged y Commitlint.

### Pendiente

- Servicios, disponibilidad semanal y consulta de horarios libres.
- Reserva, confirmacion, reprogramacion y cancelacion de turnos; calculo del score de riesgo.
- Registro publico, recuperacion de contraseña e invitaciones de miembros.
- Recordatorios por email.
- Despliegue del backend en Azure App Service y observabilidad.

El frontend tiene un workflow de despliegue manual hacia Vercel (ver [Despliegue del frontend](#despliegue-del-frontend)). No hay recursos de produccion documentados todavia.

## Stack

| Capa            | En uso                                                                         | Previsto                           |
| --------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| Frontend        | Next.js 16, React 19, TypeScript, Material UI, CSS Modules, Supabase JS (Auth) | Calendario de agenda               |
| Backend         | Node.js, Express 5, TypeScript, Zod, helmet, Prisma                            | Servicios, turnos y score          |
| Datos           | Supabase PostgreSQL y Auth, migraciones, seed y RLS                            | —                                  |
| IA              | Gemini API (`@google/genai`) con salida validada, timeout y limite por usuario | —                                  |
| Pruebas         | Vitest, Supertest y Playwright                                                 | Pruebas de turnos y concurrencia   |
| Infraestructura | Docker Compose, GitHub Actions (CI y deploy manual), Vercel                    | Azure App Service y observabilidad |

## Estructura

```text
apps/frontend/       Aplicacion Next.js (pantallas, componentes y E2E en e2e/)
apps/backend/        API Express, Prisma y tests en test/
packages/shared/     Contratos, validaciones y tipos compartidos
docs/                Arquitectura, contratos, costos y backlog
infra/docker/        Docker de desarrollo
tests/               Estrategia de pruebas
.github/workflows/   CI y deploy manual del frontend
AI-DECISIONS.md      Decisiones asistidas por IA
```

## Requisitos

- Node.js 22 y npm.
- Un proyecto de Supabase (Auth + PostgreSQL). Puede ser el del equipo o uno propio para probar.
- Una clave de Gemini API (opcional: sin ella, "Explicar con IA" responde 503 y el resto funciona).
- Docker Desktop, opcional.

## Configuracion

### 1. Dependencias

```bash
npm ci
```

### 2. Variables de entorno

Hay dos archivos, ambos ignorados por Git. Cada app lee el suyo: un `.env` en la raiz **no** se usa.

**`apps/backend/.env`** (plantilla: `.env.example` de la raiz)

| Variable            | Donde se obtiene                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`      | Supabase → Project Settings → API → Project URL                                                           |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` / publishable key                                              |
| `DATABASE_URL`      | Supabase → Connect → ORMs → Prisma: transaction pooler, puerto **6543**, con `?pgbouncer=true`            |
| `DIRECT_URL`        | Supabase → Connect → ORMs → Prisma: conexion directa o session pooler, puerto **5432** (solo migraciones) |
| `CORS_ORIGIN`       | `http://localhost:3000` (varios origenes separados por coma)                                              |
| `GEMINI_API_KEY`    | Google AI Studio. Opcional                                                                                |

En las URLs de la base, reemplazar `[YOUR-PASSWORD]` (corchetes incluidos) por el password de la base y codificar los caracteres especiales (`@` → `%40`, `#` → `%23`, `/` → `%2F`). No hacen falta comillas. El backend no usa la `service_role` key.

**`apps/frontend/.env.local`** (plantilla: `apps/frontend/.env.example`)

| Variable                        | Valor                                    |
| ------------------------------- | ---------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | El mismo `SUPABASE_URL` del backend      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | La misma `SUPABASE_ANON_KEY` del backend |
| `NEXT_PUBLIC_API_URL`           | `http://localhost:4000`                  |

El backend valida sus variables al arrancar: si falta alguna, termina con `Configuración de entorno inválida: <variables>` sin mostrar valores.

### 3. Base de datos

```bash
npm run prisma:generate --workspace=@turnosmart/backend
```

```bash
npm run prisma:migrate --workspace=@turnosmart/backend
```

`prisma:migrate` aplica las dos migraciones (tablas y RLS) usando `DIRECT_URL`. Hace falta una sola vez por proyecto de Supabase; `npx prisma migrate status` (desde `apps/backend`) muestra si ya estan aplicadas.

El seed es opcional y no crea usuarios: para asociarlo a uno existente se configura `SEED_AUTH_USER_ID`.

```bash
npm run prisma:seed --workspace=@turnosmart/backend
```

### 4. Usuario para ingresar

La app no tiene registro publico. En Supabase → Authentication → Add user, crear un usuario con email y contraseña y tildar "Auto confirm". La primera vez que ingresa pasa por el onboarding, que crea el negocio y lo asigna como OWNER.

## Desarrollo

```bash
npm run build:shared
```

En dos terminales:

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

| URL                               | Que es                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| `http://localhost:3000/`          | Agenda del negocio (requiere sesion)                         |
| `http://localhost:3000/demo`      | Dashboard con datos de ejemplo (publico)                     |
| `http://localhost:3000/login`     | Inicio de sesion                                             |
| `http://localhost:3000/customers` | Clientes (requiere sesion y negocio)                         |
| `http://localhost:3000/settings`  | Datos del negocio (editable por OWNER y ADMIN)               |
| `http://localhost:4000/health`    | Proceso de la API                                            |
| `http://localhost:4000/ready`     | API + conexion a PostgreSQL: `{"status":"ready"}` si conecta |

`dev:backend` y `dev:frontend` compilan `packages/shared` antes de arrancar; el paso `build:shared` de arriba solo hace falta si se levanta una app con `npm run dev --workspace=...`. `build` y `typecheck` generan el cliente de Prisma solo si falta (por ejemplo, despues de `npm ci`) o si cambio el schema; asi funcionan aunque la API este corriendo, que en Windows bloquea el motor de Prisma.

Con Docker (usa el mismo `apps/backend/.env` y el Supabase configurado ahi; no crea PostgreSQL local):

```bash
npm run docker:dev
```

El servicio `dependencies` sincroniza el volumen compartido `node_modules` con
`npm ci --include=dev` antes de iniciar ambas apps. Reconstruir la imagen no
actualiza por si solo un volumen existente; esto evita `prisma: not found` tras
cambios de dependencias. No hace falta borrar volúmenes ni datos de Supabase.
Si las apps ya estan corriendo, detenerlas antes de volver a ejecutar el comando
para que no lean dependencias mientras se reinstalan:

```bash
docker compose -f infra/docker/compose.dev.yml stop
npm run docker:dev
```

### Problemas frecuentes

| Sintoma                                              | Causa y solucion                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/ready` responde 503                                | El backend no llega a la base: revisar `DATABASE_URL` (password, puerto 6543, `?pgbouncer=true`).                 |
| "No se pudo cargar tu cuenta" despues del login      | La API no pudo leer la cuenta. Si el log del backend muestra `P2021`, faltan las tablas: correr `prisma:migrate`. |
| "Email o contraseña incorrectos" con datos correctos | El usuario no existe en ese proyecto de Supabase o no esta confirmado.                                            |
| Error de CORS en la consola del navegador            | `CORS_ORIGIN` no incluye la URL del frontend.                                                                     |
| `Another next dev server is already running`         | Ya hay un `next dev` en esa carpeta: usar `localhost:3000` o cerrarlo (`taskkill /PID <pid> /F`).                 |

## Calidad, pruebas y CI

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

`npm test` corre los tests unitarios del backend, sin base de datos. GitHub Actions ejecuta estos controles en pushes y pull requests hacia `dev` y `main`. No hay CD automatico: el deploy del frontend es manual (`.github/workflows/frontend-deploy.yml`).

**Integracion** (API + PostgreSQL real). Crea y borra negocios de prueba: usar una base descartable con las migraciones aplicadas, nunca la del equipo ni la de la demo.

```bash
npm run test:integration
```

**End-to-end** (sin mocks). Requiere frontend, backend y Supabase levantados, y un usuario de prueba de ese Supabase en `E2E_USER_EMAIL` y `E2E_USER_PASSWORD`. Ese usuario crea un "Negocio E2E" y clientes en la base. `E2E_BASE_URL` cambia la URL del frontend (por defecto `http://localhost:3000`).

```bash
npm run test:e2e --workspace=@turnosmart/frontend
```

Cubre login invalido, redireccion de rutas protegidas, recuperacion ante una API caida (error visible, reintento y cierre de sesion) y el recorrido alta → recarga → edicion → baja → logout de un cliente.

## Despliegue del frontend

El frontend se despliega en Vercel solo de forma manual, con el workflow **Frontend deploy (manual)** (`.github/workflows/frontend-deploy.yml`). No se despliega en cada push. Requiere una API publica con HTTPS: desde Vercel no se puede usar `http://localhost:4000`.

**1. Proyecto en Vercel**, sin repositorio de Git conectado (por ejemplo, creado con `npx vercel link --cwd apps/frontend`). En Settings → Build and Deployment:

| Ajuste                                   | Valor                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| Framework Preset                         | Next.js                                                                  |
| Root Directory                           | `apps/frontend`                                                          |
| Include files outside the root directory | Activado                                                                 |
| Install Command (Override)               | `cd ../.. && npm ci`                                                     |
| Build Command (Override)                 | `cd ../.. && npm run build:shared && cd apps/frontend && npx next build` |
| Node.js Version                          | 22.x                                                                     |

**2. Secret y variables en GitHub** (repositorio → Settings → Secrets and variables → Actions):

| Nombre              | Tipo     | Valor                                                     |
| ------------------- | -------- | --------------------------------------------------------- |
| `VERCEL_TOKEN`      | Secret   | Token de Vercel (Account Settings → Tokens)               |
| `VERCEL_ORG_ID`     | Variable | `orgId` de `apps/frontend/.vercel/project.json` o Team ID |
| `VERCEL_PROJECT_ID` | Variable | `projectId` de `apps/frontend/.vercel/project.json`       |
| `SUPABASE_URL`      | Variable | URL del proyecto de Supabase                              |
| `SUPABASE_ANON_KEY` | Variable | Anon / publishable key de Supabase                        |

Nunca cargar en GitHub ni en Vercel la `service_role`, las URLs de la base ni la clave de Gemini: son solo del backend.

**3. Desplegar:** Actions → **Frontend deploy (manual)** → Run workflow, con `target: vercel` y `api_url` igual a la URL HTTPS de la API. El workflow tiene que estar en la rama por defecto para que aparezca el boton. La URL publicada queda en el resumen de la ejecucion.

**4. Despues de cada despliegue nuevo:** agregar la URL de Vercel a `CORS_ORIGIN` del backend y configurarla como Site URL en Supabase → Authentication → URL Configuration. Si cambia la URL de la API, volver a correr el workflow: `NEXT_PUBLIC_API_URL` queda fija en el build.

El workflow tambien admite `target: azure` (Web App); requiere `output: 'standalone'` en `apps/frontend/next.config.ts`.

## Datos y multi-tenancy

El esquema incluye `Business`, `Profile`, `Customer`, `Service`, `AvailabilityRule`, `Appointment`, `AppointmentEvent`, `RiskScore` y `Reminder`.

Las entidades operativas incluyen `businessId`. Las relaciones compuestas evitan referencias entre tenants y RLS protege el acceso desde Supabase. Como la conexion de Prisma omite RLS, el backend resuelve el negocio desde el perfil del usuario (nunca desde el body) y filtra cada consulta por `businessId`; un recurso de otro negocio responde 404.

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

La identidad visual es SaaS profesional, moderna y limpia, apta para rubros como estetica, salud, consultoria y servicios profesionales. Los colores son los del tema de Material UI (`apps/frontend/src/app/theme.ts`):

| Uso                        | Color          | Hex       |
| -------------------------- | -------------- | --------- |
| Primario                   | Azul           | `#2563EB` |
| Primario hover             | Azul oscuro    | `#1D4ED8` |
| Secundario                 | Cian           | `#0891B2` |
| Exito / confirmado         | Verde          | `#15803D` |
| Advertencia / riesgo medio | Ambar          | `#B45309` |
| Error / riesgo alto        | Rojo           | `#B91C1C` |
| Fondo                      | Gris muy claro | `#F6F8FB` |
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
- [Contratos de la API](docs/contracts.md)
- [Creditos y costos](docs/costs.md)
- [Backlog](docs/backlog.md)
- [Decisiones de IA](AI-DECISIONS.md)
- [Backend](apps/backend/README.md)
- [Frontend](apps/frontend/README.md)
- [Infraestructura](infra/README.md)
- [Pruebas](tests/README.md)
