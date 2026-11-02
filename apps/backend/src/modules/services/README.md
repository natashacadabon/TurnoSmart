# B03 — Servicios

Implementa `GET /api/services`, `POST /api/services` y `PATCH /api/services/:id`.
No ofrece borrado: `active: false` conserva el servicio y sus reservas.

## Alcance aprobado

El 2026-10-30 la desarrolladora aprobo para B03 los campos, limites, filtros y
envelopes de servicios de B01, reutilizando los errores y middleware actuales
de A y agregando `SERVICE_NAME_CONFLICT` (409) al registro compartido.
Esta aprobacion parcial no cierra las decisiones generales de disponibilidad,
slots o concurrencia de B01.

- Lectura: OWNER, ADMIN y STAFF. Escritura: OWNER y ADMIN.
- `authenticate` y `requireProfile` de A resuelven identidad, negocio y rol.
- Los schemas estrictos rechazan claves desconocidas, incluidos tenant, rol,
  timestamps e IDs del servidor. Las queries repetidas tambien son invalidas.
- Las respuestas usan `ServiceDto` proyectado explicitamente, sin `businessId`.
- Los nombres se normalizan con trim; la unicidad PostgreSQL por negocio es
  sensible a mayusculas e incluye servicios inactivos. No se agrega otra politica.
- La base decide conflictos concurrentes de nombre mediante su restriccion
  existente; `P2002` se traduce a 409. PATCH usa la clave compuesta de servicio
  y negocio en una sola escritura. Un ID ajeno e inexistente responden igual.
- PATCH no modifica turnos, eventos ni sus intervalos. Omitir un campo conserva
  su valor; solo descripcion y precio admiten null.

## Compatibilidad con A y decisiones pendientes

Se conserva el formato `ApiErrorBody` de A, con `requestId` y `details` opcional
de pares path/message; no se crea otro contrato de errores. Se usan `NOT_FOUND`,
`TOKEN_INVALID` y `PROFILE_REQUIRED`. UUID invalido de servicios responde 422.
JSON malformado conserva el 422 del middleware comun. Un body no procesado como
JSON se rechaza por validacion (422); no se agrega un 415 especifico ni otro
codigo global sin acuerdo. Los fallos inesperados mantienen `INTERNAL_ERROR`
(500); no se promete el mapeo 503 propuesto en B01.

D01 general sigue pendiente de unificacion con A/C. D07 requiere coordinar con
C las escrituras de reservas frente a cambios de duracion y actividad; esta
tarea no introduce unilateralmente un protocolo de bloqueo ni asegura esa
serializacion. D08 tambien sigue pendiente: los permisos Express no restringen
por si solos las escrituras directas autorizadas por RLS en Supabase.

## Validacion reproducible

Desde la raiz del monorepo:

```sh
npm run build:shared
npm test
npm run test:integration --workspace=apps/backend -- services-http.test.ts
npm run lint
npm run typecheck
```

`test/unit/services.test.ts` prueba validaciones y argumentos/errores del
repositorio Prisma con dobles. `test/integration/services-http.test.ts` prueba
HTTP, middleware A y aislamiento con un repositorio en memoria, sin cargar
`.env` ni conectarse a Supabase. No demuestra persistencia ni RLS en una base
real. La suite API-DB existente requiere un entorno de pruebas explicito y
no se ejecuta como parte de esta comprobacion sin base local acordada.
