# Backend de TurnoSmart

API REST Express con TypeScript, Prisma 6.12 y PostgreSQL. `src/app.ts` construye la app con dependencias inyectables para Supertest. `src/index.ts` valida el entorno, conecta los repositorios e inicia el servidor y, cuando corresponde, el procesador de correo.

| Módulo                              | Responsabilidad                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `identity`, `customers`             | Supabase Auth, onboarding, permisos por rol, configuración del negocio y clientes.        |
| `services`, `availability`, `slots` | Servicios, disponibilidad semanal y horarios libres. Se comparte una agenda por negocio.  |
| `appointments`, `events`            | Reservas, notas, transiciones, reprogramación, historial y acciones firmadas del cliente. |
| `ai`                                | Score heurístico de no-show y explicación bajo demanda con Gemini.                        |
| `notifications`                     | Avisos internos y lecturas por perfil, preferencias, cola de correo y recordatorios.      |

Las rutas autenticadas usan el perfil para resolver negocio y permisos. Prisma filtra las lecturas y escrituras operativas por negocio. Las mutaciones de reserva y configuración relacionadas comparten el bloqueo de la fila `Business`. Los enlaces públicos validan su firma y vigencia antes de consultar o mutar un turno específico. Ver [arquitectura](../../docs/architecture.md) y [contratos de la API](../../docs/contracts.md).

## Desarrollo y validación

Copiar [la plantilla de entorno](../../.env.example) a `apps/backend/.env`. Configurar Supabase, las conexiones de Prisma y CORS según el [README raíz](../../README.md). La clave de Gemini es opcional. La configuración para correo, enlaces y cron se explica en la [guía de operación](../../docs/operations.md#notificaciones-de-turnos).

Desde la raíz del monorepo:

```sh
npm run prisma:generate --workspace=apps/backend
npm run prisma:migrate --workspace=apps/backend
npm run dev:backend
```

El puerto por defecto es 4000. `GET /health` informa el estado del proceso y la versión. `GET /ready` comprueba PostgreSQL. `GET /metrics` devuelve los contadores de la instancia.

Las pruebas unitarias se ejecutan con `npm test` en la raíz. Para las pruebas contra PostgreSQL, usar una base descartable migrada con `npm run test:integration`. Consultar la [guía de pruebas](../../tests/README.md), las [instrucciones del seed](prisma/README.md) y el [backlog](../../docs/backlog.md).
