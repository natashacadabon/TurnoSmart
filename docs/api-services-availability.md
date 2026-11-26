# API de servicios, disponibilidad y slots

Las rutas usan el token de Supabase y el negocio del perfil OWNER. ADMIN es global y no puede acceder a servicios ni disponibilidad. OWNER puede leer y editar estos recursos. Los errores siguen el [contrato general](contracts.md#errores) y los esquemas viven en [shared](../packages/shared/src).

| Método y ruta                 | Entrada                                                                                        | Respuesta                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/services`           | `active=true\|false\|all` (por defecto `true`), `limit` de 1 a 100 (50), `offset` desde 0 (0). | `200 { data: ServiceDto[], meta: { active, limit, offset, total } }` |
| `POST /api/services`          | `name`, `durationMinutes` y opcionalmente `description`, `priceCents`, `active`.               | `201 { data: ServiceDto }`                                           |
| `PATCH /api/services/:id`     | UUID y al menos un campo editable.                                                             | `200 { data: ServiceDto }`                                           |
| `GET /api/availability-rules` | Semana completa del negocio.                                                                   | `200 { data: { timezone, rules } }`                                  |
| `PUT /api/availability-rules` | `{ rules: [...] }`, de 0 a 100 reglas para reemplazar la semana.                               | `200 { data: { timezone, rules } }`                                  |
| `GET /api/slots`              | `date=YYYY-MM-DD`, `serviceId` y `excludeAppointmentId` opcional.                              | `200 { data: SlotDto[] }`                                            |

## Servicios

El nombre se recorta, admite de 1 a 120 caracteres y es único por negocio, con distinción de mayúsculas e inclusión de inactivos. La duración admite enteros entre 1 y 1440 minutos. La descripción admite hasta 2000 caracteres y se convierte en `null` si queda vacía después de recortarla. El precio es un entero entre 0 y 2147483647 centavos o `null`. Al crear, `active` vale `true` por defecto. El cliente recibe UUID y timestamps UTC.

Un nombre duplicado devuelve `409 SERVICE_NAME_CONFLICT` y un servicio ajeno o inexistente devuelve `404 NOT_FOUND`. Enviar `active: false` desactiva el servicio y conserva su historial. Cambiar actividad o duración mantiene los intervalos ya reservados. Una reprogramación usa la duración del servicio activo en ese momento.

## Disponibilidad semanal

Cada regla tiene `dayOfWeek` (0 domingo a 6 sábado), `startTime` y `endTime` como horas locales `HH:mm` y `active` opcional (por defecto `true`). La lectura agrega `id`, `createdAt` y `updatedAt`, incluye reglas inactivas y ordena por día, inicio, fin e ID. Una semana vacía cierra la agenda.

Ejemplo de reemplazo que deja una franja activa el lunes:

```json
{
  "rules": [{ "dayOfWeek": 1, "startTime": "09:00", "endTime": "12:00", "active": true }]
}
```

El reemplazo es atómico y conserva la identidad de reglas con la misma tupla de día, inicio y fin. Elimina las franjas omitidas. Acepta franjas adyacentes y rechaza duplicados, solapamientos y cruces de medianoche. Si deja un turno vigente fuera de una sola franja activa, devuelve `409 AVAILABILITY_CONFLICT`. Esto incluye turnos en curso. `GET` devuelve solapamientos persistidos que respetan el formato de forma individual para que puedan corregirse con `PUT`. Una hora persistida con segundos distintos de cero produce un error 500 al leerse.

## Consulta de slots

La fecha se interpreta en la zona IANA del negocio. Cada franja activa ofrece comienzos futuros cada 15 minutos desde su apertura si la duración del servicio cabe en una única franja. Se descartan solapamientos con turnos activos de cualquier servicio del mismo negocio. Los resultados se ordenan y se devuelven en UTC. Si el servicio está inactivo, la API devuelve `409 SERVICE_INACTIVE`. Si falta el servicio o pertenece a otro negocio, devuelve `404 NOT_FOUND`.

Para reprogramar, `excludeAppointmentId` omite la ocupación del turno actual si es futuro, activo, del mismo servicio y del mismo negocio. Un turno de otro servicio devuelve `409 APPOINTMENT_SERVICE_MISMATCH` y un turno iniciado o cerrado, `409 APPOINTMENT_NOT_RESCHEDULABLE`. La API devuelve 404 si el turno no existe en el negocio.

```json
{
  "data": [{ "startsAt": "2026-11-16T12:00:00.000Z", "endsAt": "2026-11-16T13:00:00.000Z" }]
}
```

Cuando no hay horarios, la respuesta es `200 { data: [] }`. Las horas ambiguas, inexistentes o con cambios de offset dentro de la franja provocan `409 AVAILABILITY_TIME_UNRESOLVABLE`. Cambiar la zona del negocio requiere que los turnos vigentes sigan dentro de la disponibilidad.

La consulta es de solo lectura. Crear o mover un turno bloquea la fila del negocio dentro de la transacción y vuelve a verificar la configuración y los solapamientos. El conflicto de reserva devuelve `409 APPOINTMENT_TIME_CONFLICT`. El protocolo y los límites de la Data API están en [arquitectura](architecture.md).
