# Contratos comunes (A01)

Fuente de verdad en código: [`packages/shared/src`](../packages/shared/src). Este documento resume lo acordado.

## Convenciones

- IDs UUID. Timestamps ISO 8601 en UTC (`2026-11-09T14:00:00.000Z`).
- Fechas locales `YYYY-MM-DD`; horarios recurrentes `HH:mm`; día 0 = domingo.
- Zona horaria siempre desde `Business.timezone` (IANA).
- Autenticación: `Authorization: Bearer <access_token de Supabase>`.
- El negocio (`businessId`) **nunca** se lee del body ni de la URL: se resuelve desde `Profile`.
- Paginación: `page` (desde 1) y `pageSize` (máx. 50).

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
turnos y piden explicaciones. Gestión de miembros: fuera del checkpoint.

## Identidad

- `GET /api/me` → `{ onboarded: false, user }` o `{ onboarded: true, user, profile, business }`.
- `POST /api/onboarding` `{ businessName, timezone?, fullName? }` → 201 la primera vez; 200 con el mismo negocio si se
  repite (también ante requests concurrentes). El rol `OWNER` lo asigna el backend. `Profile.email` se toma del usuario de
  Supabase Auth; una cuenta sin email recibe 422.
- `PATCH /api/business` `{ name?, timezone? }` → `BusinessDto`. Sólo OWNER/ADMIN.

## Clientes

- `GET /api/customers?search=&page=&pageSize=` → `Paginated<CustomerDto>`. Busca en nombre, email y teléfono.
- `POST /api/customers` `{ fullName, email?, phone?, notes? }` → 201. Email opcional, no único. Cadenas vacías → `null`.
  El email se guarda sin espacios y en minúsculas. El teléfono acepta dígitos, espacios, guiones, paréntesis y `+` inicial,
  con al menos 6 dígitos (`+54 221 555-1234`); otro texto responde 422 en `phone`.
- `GET /api/customers/:id`, `PATCH /api/customers/:id` (parcial).
- `DELETE /api/customers/:id` → 204. Solo OWNER/ADMIN (`customers:delete`). Si el cliente tiene turnos responde
  409 `CUSTOMER_HAS_APPOINTMENTS` y no borra nada: los turnos lo referencian y conservan el historial.

## Historial y riesgo (consumo de contratos de C)

- `GET /api/appointments/:id/events` → `AppointmentEventDto[]` en orden cronológico:
  `{ id, appointmentId, type, metadata, createdAt }`. `type` es el enum `AppointmentEventType` del schema
  (`CREATED`, `RESCHEDULED`, `CONFIRMED`, `CANCELLED`, `COMPLETED`, `MARKED_NO_SHOW`). Si C quiere exponer estado
  anterior/nuevo o actor, van dentro de `metadata`. A sólo lee; C escribe turno + evento atómicamente.
- `POST /api/appointments/:id/risk/explanation` →
  `RiskExplanationResponse { risk, explanation: { summary, recommendations[] }, model, generatedAt, disclaimer }`.
- Factores de riesgo (`RiskFactor`): `{ code, label, impact, value? }`. C persiste en `RiskScore.factors` un array con
  esa forma. Cualquier otro campo se descarta antes de enviar a Gemini.
