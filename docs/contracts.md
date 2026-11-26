# Contratos de la API

Fuente de verdad en código: [`packages/shared/src`](../packages/shared/src). Este documento resume lo acordado.

## Convenciones

- IDs UUID. Timestamps ISO 8601 en UTC (`2026-11-09T14:00:00.000Z`).
- Fechas locales `YYYY-MM-DD`; horarios recurrentes `HH:mm`; día 0 = domingo.
- La fecha de consulta de slots se interpreta en `Business.timezone` (IANA). Los filtros `from` y `to` del listado de turnos usan días UTC, con ambos días incluidos.
- Autenticación: `Authorization: Bearer <access_token de Supabase>`.
- El negocio (`businessId`) **nunca** se lee del body ni de la URL: se resuelve desde `Profile`.
- Clientes y turnos usan `page` (desde 1) y `pageSize` (máx. 50).

## Errores

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Datos inválidos",
    "details": [{ "path": "email", "message": "Email inválido" }],
    "requestId": "5b0c…"
  }
}
```

| HTTP | code                               | Cuándo                                                        |
| ---- | ---------------------------------- | ------------------------------------------------------------- |
| 401  | `UNAUTHENTICATED`, `TOKEN_INVALID` | Falta token / token inválido o vencido                        |
| 403  | `PROFILE_REQUIRED`                 | Cuenta autenticada sin negocio (debe hacer onboarding)        |
| 403  | `FORBIDDEN`                        | Rol sin permiso, u origen CORS no permitido                   |
| 404  | `NOT_FOUND`                        | Recurso inexistente **o de otro negocio** (no se distingue)   |
| 404  | `RISK_NOT_AVAILABLE`               | Turno sin score calculado                                     |
| 409  | `CONFLICT`                         | Conflictos de negocio (reservas: C)                           |
| 409  | `CUSTOMER_HAS_APPOINTMENTS`        | Baja de un cliente que tiene turnos                           |
| 422  | `VALIDATION_ERROR`                 | Entrada inválida, JSON mal formado o cuenta de Auth sin email |
| 429  | `RATE_LIMITED` / `AI_RATE_LIMITED` | Límite propio por usuario / cuota de Gemini agotada           |
| 502  | `AI_INVALID_RESPONSE`              | Gemini respondió fuera de formato dos veces                   |
| 503  | `AI_UNAVAILABLE`                   | IA no configurada o caída                                     |
| 504  | `AI_TIMEOUT`                       | Gemini no respondió dentro de `GEMINI_TIMEOUT_MS`             |

## Contexto autenticado

```ts
interface AuthContext {
  userId: string;
  email: string | null;
  businessId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}
```

Matriz de permisos (`PERMISSIONS` en shared): OWNER/ADMIN configuran el negocio; los tres roles gestionan clientes,
turnos y piden explicaciones. La baja de clientes requiere OWNER o ADMIN.

## Identidad

- `GET /api/me` → `{ onboarded: false, user }` o `{ onboarded: true, user, profile, business }`.
- `POST /api/onboarding` `{ businessName, timezone?, fullName? }` → 201 la primera vez; 200 con el mismo negocio si se
  repite (también ante requests concurrentes). El rol `OWNER` lo asigna el backend. `Profile.email` se toma del usuario de
  Supabase Auth; una cuenta sin email recibe 422.
- `PATCH /api/business` `{ name?, timezone? }` → `BusinessDto`. Solo OWNER/ADMIN. Un cambio de zona que deje turnos vigentes fuera de disponibilidad devuelve `409 AVAILABILITY_CONFLICT`.

## Clientes

- `GET /api/customers?search=&page=&pageSize=` → `Paginated<CustomerDto>`. Busca en nombre, email y teléfono.
- `POST /api/customers` `{ fullName, email?, phone?, notes? }` → 201. Email opcional, no único. Cadenas vacías → `null`.
  El email se guarda sin espacios y en minúsculas. El teléfono acepta dígitos, espacios, guiones, paréntesis y `+` inicial,
  con al menos 6 dígitos (`+54 221 555-1234`); otro texto responde 422 en `phone`.
- `GET /api/customers/:id`, `PATCH /api/customers/:id` (parcial).
- `DELETE /api/customers/:id` → 204. Solo OWNER/ADMIN (`customers:delete`). Si el cliente tiene turnos responde
  409 `CUSTOMER_HAS_APPOINTMENTS` y no borra nada: los turnos lo referencian y conservan el historial.

## Historial y riesgo

- `GET /api/appointments/:id/events` → `AppointmentEventDto[]` en orden cronológico:
  `{ id, appointmentId, type, metadata, createdAt }`. `type` corresponde al enum `AppointmentEventType` de Prisma. El turno y el evento se escriben atómicamente. Los metadatos pueden incluir la transición, el actor o la referencia a una solicitud, según el evento.
- `POST /api/appointments/:id/risk/explanation` →
  `RiskExplanationResponse { risk, explanation: { summary, recommendations[] }, model, generatedAt, disclaimer }`.
- El score se calcula y persiste al crear o reprogramar. Gemini recibe el score, nivel y los factores `{ code, label, impact, value? }` saneados.

## Turnos

- `GET /api/appointments?from=&to=&status=&page=&pageSize=` devuelve `AppointmentsResponse`.
- `POST /api/appointments` recibe `{ customerId, serviceId, startsAt, notes? }` y devuelve `201` con el turno.
- `GET /api/appointments/:id` devuelve `AppointmentDto`.
- `PATCH /api/appointments/:id` permite modificar únicamente `notes`.
- `POST /api/appointments/:id/reschedule` recibe `{ startsAt }` y mantiene el estado actual.
- Las acciones de estado usan `POST /api/appointments/:id/{confirm,cancel,complete,no-show}`.

Un turno activo usa `operationalStatus: SCHEDULED`. Su `confirmationStatus` puede ser `PENDING` o `CONFIRMED`. El campo `status` y su filtro conservan la proyección anterior. `CANCELLED`, `COMPLETED` y `NO_SHOW` son estados terminales. La reprogramación valida disponibilidad y solapamientos dentro de la transacción y conserva la confirmación. Un conflicto de horario devuelve `409 APPOINTMENT_TIME_CONFLICT`. Un cambio efectivo de horario invalida los enlaces anteriores.

### Preferencias y acciones del cliente

- `GET /api/business/notification-preferences` devuelve las preferencias del negocio de la sesión. `PATCH` admite un objeto parcial para OWNER y ADMIN. Los booleanos de email son `bookingEmailEnabled`, `confirmationEmailEnabled`, `cancellationEmailEnabled` y `rescheduleEmailEnabled`. Los negocios nuevos reciben el correo de reserva activado. Las preferencias existentes se conservan al migrar.
- `remindersEnabled` y `reminderHours` configuran hasta tres anticipaciones distintas entre 2, 6, 12, 24, 48 y 72 horas. Inicialmente 48 y 24. Los campos históricos `reminder24hEnabled` y `reminder48hEnabled` mantienen compatibilidad y se sincronizan con la configuración de anticipaciones. Cambiar preferencias reconcilia trabajos pendientes de reservas futuras y conserva los envíos procesados.
- `customerConfirmationEnabled`, `customerCancellationEnabled` y `customerRescheduleEnabled` regulan las acciones públicas. `cancellationMinimumHours` y `rescheduleMinimumHours` admiten enteros de 0 a 720. Preview devuelve `allowed: false` si una acción se deshabilita o vence su plazo. Ejecutar confirmación o solicitud deshabilitadas devuelve `403 FORBIDDEN`. Cancelación conserva `409 APPOINTMENT_CANCELLATION_NOT_ALLOWED`. La consulta pública de slots también verifica la política. El personal conserva sus permisos internos.
- Crear una reserva persiste el correo de forma atómica y solicita su procesamiento asíncrono después de completar la respuesta HTTP. Los fallos mantienen la reserva y el trabajo para su reintento.
- `POST /api/appointments/:id/action-links` requiere `appointments:write` y recibe `{ action }` con `CONFIRM`, `CANCEL` o `REQUEST_RESCHEDULE`. Devuelve `{ token, expiresAt }` para un turno futuro y un cliente con email. Configurar `APPOINTMENT_ACTION_SECRET` con 32 bytes aleatorios en hexadecimal para habilitar la emisión. Sin esta clave la emisión devuelve `503 APPOINTMENT_ACTIONS_UNAVAILABLE`. Cambiar el secreto invalida enlaces emitidos con el anterior.
- `POST /api/public/appointment-actions/preview` recibe `{ token }` y devuelve negocio, servicio, horario, zona, acción y disponibilidad de la acción. `POST /api/public/appointment-actions` requiere `{ token, confirmed: true }`, admite `message` de hasta 500 caracteres para una solicitud de cambio y devuelve `204`. Un enlace vencido, inválido o de un horario anterior devuelve `404`. Una cancelación bloqueada por la política devuelve `409 APPOINTMENT_CANCELLATION_NOT_ALLOWED`.
- `GET /api/appointments/:id/reschedule-request` devuelve `{ id, message, createdAt, requestedStartsAt? }` o `null` con `appointments:read`. Con `appointments:write`, `POST /api/appointments/:id/reschedule-request/approve` recibe `{ requestId, startsAt }` y devuelve el turno actualizado. `POST /api/appointments/:id/reschedule-request/dismiss` recibe `{ requestId }` y devuelve `204`. Mientras esté pendiente, el turno conserva la reserva original. Un cambio efectivo desde la ruta de reprogramación existente también resuelve la solicitud.
- `GET /api/appointments/:id/events?includeRequests=true` incluye `RESCHEDULE_REQUESTED` y `RESCHEDULE_REQUEST_DISMISSED`. La aprobación usa `RESCHEDULED` con referencia a la solicitud.
- `POST /api/public/appointment-actions/slots` recibe `{ token, date }` para un enlace de reprogramación y devuelve `{ data: SlotDto[] }`. La ejecución pública admite `requestedStartsAt`, que se valida contra los slots vigentes y se guarda como propuesta. El listado de turnos agrega `rescheduleRequested` para indicar un pedido pendiente.
- `GET /api/business/notification-preferences/preview/:kind` devuelve `{ subject, html }` con la plantilla real, datos de ejemplo y enlaces de muestra para el negocio autenticado.

### Centro interno de notificaciones

Todas las rutas requieren `appointments:read`.

- `GET /api/notifications?limit=&cursor=&filter=` devuelve `{ items, unreadCount, nextCursor }`. El límite es de 1 a 50 (20 por defecto), el cursor es un UUID y el filtro admite `all` y `unread`.
- `POST /api/notifications/sync-upcoming` sincroniza avisos próximos y devuelve `{ items }`.
- `PATCH /api/notifications/:id/read` registra la lectura del perfil y devuelve `{ readAt, unreadCount }`. `PATCH /api/notifications/read-all` marca todos como leídos y devuelve `204`.
- `includeRequests=true` incorpora avisos `RESCHEDULE_REQUESTED` en el listado, el conteo y las operaciones de lectura.

## Servicios y disponibilidad

Consultar las rutas de [servicios, reglas semanales y slots](api-services-availability.md).
