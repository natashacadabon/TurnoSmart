# Shared

Contratos compartidos entre frontend y backend: tipos de request y response, constantes y schemas de validación con Zod. No depende del navegador ni de la base de datos.

Exporta `AppointmentStatus` y `RiskLevel`, conservando los tipos existentes.
`AppointmentStatus` usa `SCHEDULED`, igual que el enum persistido por Prisma.

## Contratos de lectura del modulo B

El 2026-10-30 la desarrolladora aprobo en esta tarea el alcance minimo de lectura:
`ServiceDto`, `AvailabilityRuleDto` y `SlotDto`, sin `businessId`, fechas UTC y
horas locales como strings, conservando `null` en descripcion y precio.
La constante `SLOT_INTERVAL_MINUTES = 15` refleja el intervalo de comienzos
previamente indicado por la desarrolladora; no es la duracion de un servicio.

```ts
import type { ServiceDto, AvailabilityRuleDto, SlotDto } from '@turnosmart/shared';
import { SLOT_INTERVAL_MINUTES } from '@turnosmart/shared';
```

La entrada publica existente en `package.json` apunta a `dist/index.js` y
`dist/index.d.ts`. Ejecutar `npm run build --workspace=packages/shared` antes de
consumir el paquete compilado. No se agregan imports artificiales en las apps;
al integrarlas, declarar su dependencia del workspace compartido.

Los DTOs describen objetos de lectura, no respuestas HTTP completas ni entradas.
No importan Prisma ni exponen contexto de autenticacion. TypeScript no valida
UUIDs, horas, enteros ni JSON en ejecucion, tampoco elimina propiedades extras:
el backend debe proyectar explicitamente campos, verificar identidad y rol,
resolver `businessId` en servidor y filtrar todos los accesos por negocio.

### Decisiones pendientes de B01

Esta aprobacion parcial no cierra los acuerdos con A/C documentados en
[B01](../../docs/api-services-availability.md):

- D01: envelopes HTTP, errores, autenticacion y permisos.
- D02: validaciones, normalizacion, limites y defaults de servicios.
- D03: reemplazo semanal y preservacion de turnos.
- D04: cambios de servicio y reprogramaciones.
- D05: coordinacion con C de agenda unica y grilla de 15 minutos; requests y metadata.
- D06: politicas temporales, DST y cambios de zona. Se aprueba aqui solo la
  representacion de lectura: timestamps UTC ISO 8601 con milisegundos y Z,
  horas semanales HH:mm locales y dias 0 domingo a 6 sabado.

Para servicios, B03 ya implementa requests, envelopes y validadores en `services.ts`,
usados por la API; ver [alcance B03](../../apps/backend/src/modules/services/README.md).
Para disponibilidad y slots, requests, envelopes, errores y validadores quedan pendientes. No se agregan
enums de roles/estados ni tipos de error alternativos. D07 (concurrencia) y D08
(autorizacion de escrituras directas a Supabase) siguen pendientes y los DTOs
no los resuelven. La frase de B01 sobre una politica DST "acordada" no se toma
como evidencia de aprobacion mientras D06 permanezca abierto.

| Archivo           | Contenido                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `errors.ts`       | Códigos de error de la API, su status HTTP y la forma del cuerpo de error.                                       |
| `identity.ts`     | Roles, matriz de permisos (`can`), contexto autenticado, `/api/me`, onboarding y edición del negocio.            |
| `customers.ts`    | DTO de cliente, paginación y schemas de alta, edición y listado (email normalizado, teléfono validado).          |
| `appointments.ts` | Estados de turno y tipos de evento (iguales a los enums de Prisma), historial, score de riesgo y explicación IA. |

El detalle de endpoints y errores está en [docs/contracts.md](../../docs/contracts.md).

## Uso

El paquete es ESM y se consume compilado desde `dist/`:

```bash
npm run build:shared
```

`dev:frontend`, `dev:backend`, `build`, `typecheck` y `test` de la raíz lo compilan antes de usarlo. Después de cambiar algo en `src/`, volver a compilarlo si una app ya está corriendo.

Cada cambio de contrato tiene que mantener alineados el backend, el frontend y, para estados y eventos, los enums de `apps/backend/prisma/schema.prisma`.
