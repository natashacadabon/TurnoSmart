# B04 — Disponibilidad semanal

Implementa `GET /api/availability-rules` y `PUT /api/availability-rules`
con rutas y repositorio, siguiendo B03. Reutiliza `AvailabilityRuleDto`, los
schemas y envelopes compartidos y los errores/middleware existentes de A.

- `authenticate` y `requireProfile` resuelven el negocio exclusivamente desde
  el usuario verificado. Lectura OWNER/ADMIN/STAFF; escritura OWNER/ADMIN.
- GET incluye inactivas y timezone de Business. Orden por dia, inicio, fin e ID.
  No acepta query. Una semana vacia no significa disponibilidad permanente.
- PUT exige `rules` (0..100), con objetos estrictos: dia entero 0..6, horas
  `HH:mm` 00:00..23:59, inicio anterior al fin, active boolean default true.
  Rechaza campos protegidos, duplicados y solapamientos incluso inactivos.
  Acepta adyacencia; no acepta cruces de medianoche.
- Prisma transporta TIME como Date auxiliar UTC: se conservan hora/minuto sin
  conversion de zona. Un legado con segundos no se trunca: GET devuelve 500.
  PUT puede corregirlo reemplazando el conjunto completo.
- El reemplazo borra omitidas y hace upsert por negocio/dia/inicio/fin dentro
  de una unica transaccion. Conserva ID/createdAt de tuplas existentes. Una
  semana vacia elimina todas las reglas del negocio. Los fallos hacen rollback.
- Un bloqueo de la fila Business serializa los PUT del mismo negocio incluso
  cuando no existen reglas. Prevalece el ultimo reemplazo; no hay ETag/version.

## D03 aprobada y limites de integracion

El 2026-10-30 la desarrolladora aprobo expresamente D03 para B04: rechazar con
409 `AVAILABILITY_CONFLICT` un reemplazo que deje turnos vigentes fuera de una
unica franja activa, sin cancelar, reprogramar ni modificar turnos/eventos.

Dentro de la transaccion se consultan exclusivamente turnos del negocio
SCHEDULED/CONFIRMED con endsAt posterior al instante de evaluacion, despues de
adquirir el bloqueo. Incluye turnos en curso y usa startsAt/endsAt persistidos,
sin recalcular la duracion del servicio. Los limites se comparan en la zona
del negocio y con precision de segundos/milisegundos de los turnos.

D06 sigue pendiente para transiciones horarias: si un turno vigente atraviesa
un cambio de offset, el PUT aborta con `INTERNAL_ERROR` sin escribir. No se
elige una conversion de hora ambigua/inexistente ni se incorpora una politica
DST no aprobada. Una zona IANA persistida invalida tambien responde 500.

D07 sigue pendiente: el bloqueo de B04 no garantiza que C vuelva a comprobar
disponibilidad despues de esperar un bloqueo. C debe acordar e implementar un
protocolo comun de transaccion/revalidacion antes de integrar reservas
concurrentes con cambios semanales. No se modifico C.

D08 sigue pendiente: RLS actual permite escrituras directas de miembros que
pueden omitir permisos/validaciones Express. Estos tests no certifican RLS.

Se mantienen los errores de A/B03: details opcionales path/message, requestId,
JSON malformado y contenido no procesado como JSON con 422; fallos inesperados 500. Se agrega solo `AVAILABILITY_CONFLICT` (409), sin otro formato global.

## Verificacion

Desde la raiz del monorepo:

```sh
npm run lint
npm run typecheck
npm test
npm run test:integration --workspace=apps/backend -- availability-http.test.ts services-http.test.ts
```

Las unitarias cubren contrato, horarios y argumentos/errores del repositorio.
La suite HTTP utiliza middleware real y repositorio en memoria, sin `.env`.

`availability-db.test.ts` verifica API + PostgreSQL: TIME, permisos, aislamiento,
identidad de reglas, rollback despues de borrar/insertar, PUT concurrentes,
turnos en curso, estados bloqueantes/no bloqueantes y conservacion de turnos y
eventos. Requiere DATABASE_URL/DIRECT_URL apuntando a una **base descartable**
con las migraciones existentes, nunca al entorno compartido ni a la demo:

```sh
npm run test:integration --workspace=apps/backend
```

Para esta implementacion se uso una base temporal independiente en PostgreSQL
local, con ambas migraciones y una funcion auth.uid() de prueba que retorna
NULL para poder aplicar la migracion RLS. La API usa FakeVerifier y la conexion
de pruebas usa postgres; no verifica autenticacion Supabase ni politicas RLS.
La base se elimino al terminar. No se cambiaron schema, migraciones ni `.env`.
