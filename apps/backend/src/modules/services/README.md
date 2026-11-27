# Servicios

`GET /api/services` lista servicios. `POST /api/services` crea y `PATCH /api/services/:id` edita, activa o desactiva. La interfaz de administración está en `/services`. Ver parámetros, respuestas y errores en el [contrato HTTP](../../../../../docs/api-services-availability.md#servicios).

Sólo OWNER puede leer y escribir servicios. ADMIN gestiona la plataforma desde su panel global y no accede a esta ruta. Express autentica al usuario y resuelve el negocio a partir del perfil. La unicidad de nombre por negocio se aplica en PostgreSQL, incluye inactivos y distingue mayúsculas. Las colisiones devuelven `409 SERVICE_NAME_CONFLICT`.

Al modificar duración o actividad, el repositorio comparte el bloqueo de la fila del negocio con la reserva y reprogramación. Los turnos existentes conservan el intervalo guardado. Las reservas nuevas y las reprogramaciones usan la configuración vigente.

Desde la raíz:

```sh
npm run build:shared
npm run test:integration --workspace=apps/backend -- services-http.test.ts
```

Esta suite HTTP usa dobles. La persistencia y el aislamiento se prueban con PostgreSQL en `tenant-isolation.test.ts` y las carreras con reservas en `booking-configuration-race.test.ts`. Ver [guía de pruebas](../../../../../tests/README.md).
