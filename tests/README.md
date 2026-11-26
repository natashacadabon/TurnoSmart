# Pruebas

Ejecutar los comandos desde la raíz con Node.js 22 y las dependencias instaladas.

| Suite                     | Alcance                                                                                                                                                 | Comando                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Unitarias                 | Instalación de hooks, scripts Docker y backend con dobles. Cubre identidad, clientes, servicios, disponibilidad, slots, reservas, riesgo, email y seed. | `npm test`                                      |
| Configuración de frontend | Validación de variables públicas, selección de despliegue y limpieza de previews.                                                                       | `npm run test:config --workspace=apps/frontend` |
| Integración               | API, concurrencia, rollback, aislamiento, slots, acciones públicas y cola de correo contra PostgreSQL.                                                  | `npm run test:integration`                      |
| Navegador                 | Login, clientes, servicios, agenda, detalle, avisos, preferencias y acciones públicas. Combina escenarios reales y simulaciones de Auth o API.          | `npm run test:e2e --workspace=apps/frontend`    |

## Integración con PostgreSQL

Configurar `DATABASE_URL` y `DIRECT_URL` de una base descartable con las migraciones aplicadas. Las suites crean y eliminan datos. Las pruebas de correo usan un proveedor simulado y un reloj controlado. Las suites HTTP de servicios, disponibilidad y slots usan dobles y pueden ejecutarse sin PostgreSQL:

```sh
npm run build:shared
npm run test:integration --workspace=apps/backend -- services-http.test.ts availability-http.test.ts slots-http.test.ts
```

Las pruebas de aislamiento de Express y Prisma verifican sus filtros. La suite de integración también comprueba restricciones de acceso a las tablas nuevas. La validación de roles de la Data API para las tablas de dominio queda en el [backlog](../docs/backlog.md).

## Navegador

Instalar Chromium con `npx playwright install chromium`. Levantar el frontend y ajustar `E2E_BASE_URL` si usa un puerto distinto de 3000. Para correr toda la suite, levantar además backend y Supabase y definir `E2E_USER_EMAIL` y `E2E_USER_PASSWORD` de un usuario de prueba. El flujo crítico usa una cuenta real y simula el fallo de `/api/me` para comprobar la recuperación.

Para probar agenda y enlaces públicos con respuestas interceptadas:

```sh
npm run test:e2e --workspace=apps/frontend -- new-appointment public-appointment-actions calendar-events notification-settings services --workers=1
```

El workflow [TurnoSmart CI](../.github/workflows/ci.yml) ejecuta formato, lint, validación de Prisma, tipos, unitarias, pruebas de configuración y builds. Las suites de PostgreSQL y navegador se ejecutan por separado. El recorrido con Resend y Supabase Cron en el entorno publicado se verifica siguiendo la [guía de operación](../docs/operations.md#notificaciones-de-turnos).

## Validación local del 25 de noviembre de 2026

Registro de la última ejecución completa local del desarrollo integrado en la PR #30. Los conteos describen esa ejecución y pueden variar si cambian las pruebas. Se usaron Windows, PowerShell, Node.js 24.16.0 y npm 11.13.0; el proyecto y CI declaran Node.js 22. No son resultados del entorno publicado ni una ejecución local con Node.js 22:

| Comprobación | Resultado y alcance                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`   | 216 pruebas unitarias de backend, 14 de instalación/hooks y 4 de scripts Docker aprobadas.                                                                                                                           |
| PostgreSQL   | 110 pruebas de integración aprobadas en una base descartable. Se aplicaron las nueve migraciones, incluidas las seis nuevas de acciones públicas, correo y preferencias.                                             |
| Navegador    | 56 E2E aprobadas y una omitida al ejecutar `new-appointment.spec.ts`, `services.spec.ts`, `notification-settings.spec.ts` y `public-appointment-actions.spec.ts`. La omitida requiere cuenta E2E y servicios reales. |
| Lint y tipos | Lint sin errores y typecheck aprobado. La advertencia de `Eye` sin uso observada en esa ejecución fue eliminada posteriormente en el código integrado.                                                               |
| Build        | Compilación completada al repetir el comando tras el aviso de seguridad de Next.js. El aviso de la versión instalada requiere revisión; repetir el build no lo corrige.                                              |
| Commits      | Commitlint verificó los cinco commits sin errores ni advertencias.                                                                                                                                                   |

Las E2E de esas cuatro suites usan respuestas interceptadas para Auth y API y comprueban creación, edición, cancelación, solicitudes de reprogramación, sincronización de agenda, toasts, campana global, protección de borradores, permisos de interfaz, slots y preferencias. La revisión responsive cubrió 1920, 1440, 1366, 1024, 768 y 375 px. Las ocho plantillas de correo se renderizaron en navegador desktop y mobile; se comprobó el orden y tamaño de acciones y el único scroll del modal.

Estos resultados no equivalen a recepción real de emails, renderizado dentro de Gmail/Outlook, activación del Cron en Supabase o validación de una instalación publicada. Tampoco prueban automáticamente toda la suite de navegador con backend y Auth reales. Los pasos de entrega pendientes se mantienen en el [backlog](../docs/backlog.md) y la [guía de operación](../docs/operations.md#validación-en-el-entorno-publicado).

## P0-06 · Backups PostgreSQL (26 de noviembre de 2026)

Con Windows, PowerShell 7.6.9, Node 22.23.4 y npm 10.9.9:

```powershell
npm run test:backup
npm run test:backup:integration
```

- **14 pruebas de scripts aprobadas:** conexión directa/session, ausencia de credenciales, falta de fallback a `DATABASE_URL`, rutas fuera del checkout y sus alias físicos, symlinks/junctions, clave privada sin sobrescritura, AES-256-GCM, checksums, metadata alterada, errores de `pg_dump`, archivos inválidos, publicación fallida sin borrar backups ajenos, destinos/daemon incorrectos, interrupción controlada, limpieza y reglas de Git. Se ejecutan también desde `npm test`; no requieren PostgreSQL remoto.
- **8 pruebas de integración aprobadas** (suite y siete escenarios) sobre contenedores PostgreSQL 16 nuevos, sin red ni volúmenes persistentes. Se aplicaron las nueve migraciones SQL históricas sin modificarlas y se creó un historial sintético `_prisma_migrations` con sus checksums. No se atribuye ese historial a una ejecución del motor Prisma Migrate.
- Se verificaron dos negocios, dos perfiles, dos clientes, un servicio, un turno originalmente confirmado y dos eventos. Los hashes de datos, migraciones, propietarios y concesiones efectivas coinciden después de recuperar; RLS limita un perfil a su negocio, `anon` no puede leer clientes y `authenticated` no obtiene escritura directa de turnos. No hay referencias huérfanas ni constraints sin validar. La escritura antigua `status='CONFIRMED'` fue rechazada y no alteró el fixture.
- Se comprobaron nombre ocupado sin modificarlo, extensión ausente, dump modificado aun recalculando el checksum exterior, interrupción de restore, fallo real de `pg_restore` y limpieza por ID/etiqueta. Al finalizar no quedaron contenedores de prueba ni de recuperación de estas suites.
- Último ensayo: **backup 3,649 s; recuperación total PowerShell 6,707 s (motor verificado: 6,017 s)**, para ese fixture pequeño. Es tiempo PostgreSQL local incluyendo arranque del destino; no RTO de producción ni de Supabase integral.
- `npm test` también aprobó las 216 unitarias existentes del backend, 14 de instalación y 4 de scripts Docker. Typecheck y las 52 pruebas de configuración del frontend fueron aprobadas. El formato global conserva 77 advertencias preexistentes; los archivos de este cambio cumplen Prettier y los tres scripts PowerShell pasan su parser.

En Windows la prueba de interrupción emite el evento cooperativo SIGTERM dentro del proceso Node; no prueba que `TerminateProcess`/`taskkill /F` ejecute limpieza. Las terminaciones forzadas y la recuperación de Supabase Auth/Storage/secretos/extensiones reales quedan fuera de esta evidencia. Ver el [runbook](../docs/operations.md#backup). El aviso histórico de Next.js consignado en la validación anterior fue corregido y comprobado separadamente en [P0-05](../docs/operations.md#seguridad-de-nextjs-p0-05).
