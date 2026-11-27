# Disponibilidad semanal

`GET /api/availability-rules` devuelve toda la semana del negocio. `PUT /api/availability-rules` reemplaza la semana en una transacción. Las rutas representan las horas locales con `HH:mm` en la zona del negocio según el [contrato HTTP](../../../../../docs/api-services-availability.md#disponibilidad-semanal). La pantalla de edición está en `/services`.

Sólo OWNER puede leer y editar la disponibilidad operativa de su negocio. ADMIN gestiona la plataforma desde su panel global y no accede a esta ruta. El reemplazo conserva la identidad de las franjas con la misma tupla día, inicio y fin, y elimina las omitidas. Si deja turnos vigentes o en curso fuera de una franja activa, responde `409 AVAILABILITY_CONFLICT`. Se usa el intervalo guardado de cada turno. El último reemplazo válido prevalece.

La escritura bloquea la fila del negocio. El alta y la reprogramación de turnos, las ediciones de servicio y los cambios de zona usan ese mismo bloqueo para evitar validar con configuraciones obsoletas. La consulta de slots rechaza una franja con horas ambiguas o inexistentes, o que atraviesa un cambio de offset. Si un turno vigente atraviesa una transición de offset, la validación del reemplazo puede responder `500 INTERNAL_ERROR`.

Desde la raíz:

```sh
npm run build:shared
npm run test:integration --workspace=apps/backend -- availability-http.test.ts
```

La suite HTTP usa dobles. `availability-db.test.ts`, `slots-db.test.ts` y `booking-configuration-race.test.ts` requieren PostgreSQL con las migraciones. Ver [guía de pruebas](../../../../../tests/README.md).
