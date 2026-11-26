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
npm run test:e2e --workspace=apps/frontend -- new-appointment public-appointment-actions calendar-events
```

El workflow [TurnoSmart CI](../.github/workflows/ci.yml) ejecuta formato, lint, validación de Prisma, tipos, unitarias, pruebas de configuración y builds. Las suites de PostgreSQL y navegador se ejecutan por separado. El recorrido con Resend y Supabase Cron en el entorno publicado se verifica siguiendo la [guía de operación](../docs/operations.md#notificaciones-de-turnos).
