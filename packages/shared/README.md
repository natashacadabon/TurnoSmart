# Shared

Paquete inicial para tipos y logica compartida.

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

Requests, envelopes, errores y validadores quedan pendientes. No se agregan
enums de roles/estados ni tipos de error alternativos. D07 (concurrencia) y D08
(autorizacion de escrituras directas a Supabase) siguen pendientes y los DTOs
no los resuelven. La frase de B01 sobre una politica DST "acordada" no se toma
como evidencia de aprobacion mientras D06 permanezca abierto.

## Contenido planificado

- tipos de request y response;
- constantes de estados y riesgo;
- schemas de validacion reutilizables;
- reglas puras del score heuristico;
- utilidades sin dependencias de navegador o base de datos.
