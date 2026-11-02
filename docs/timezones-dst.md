# D06 — Politica de zonas horarias y DST de B04/B05

Estado: **resuelta para B04/B05**, 2026-11-02. La solicitud de resolver D06 autoriza
esta politica; su adopcion por Agenda/C queda como trabajo de integracion.
No depende de endpoints de Agenda ni modifica reservas, schema o migraciones.

## Representacion y auditoria

- Business.timezone es el nombre IANA del negocio, obtenido desde servidor. UTC
  y aliases IANA reconocidos por Intl son validos; offsets numericos como +03:00
  no sustituyen una zona. No se usa la zona del navegador/proceso ni un offset fijo.
- AvailabilityRule guarda horas locales HH:mm en TIME(0), sin fecha/offset. Prisma
  las transporta con fecha auxiliar UTC: leer sus componentes UTC conserva la hora
  de pared. Segundos legados no se truncan; son configuracion persistida invalida.
- Appointment guarda instantes UTC TIMESTAMPTZ(3). Al comprobar cobertura se usan
  startsAt/endsAt completos, no la duracion actual del servicio ni horas redondeadas.
- `src/lib/business-time.ts` es el unico motor de conversion de B04/B05. Intl/ICU
  provee las reglas IANA; el calendario gregoriano proleptico y digitos latinos
  son explicitos. Se usa setUTCFullYear para evitar el ajuste de Date.UTC de
  anios 0..99 a 1900..1999; la era permite representar el anio ISO 0000.

La auditoria encontro conversiones duplicadas: B04 comparaba solo extremos en
hora local y devolvia 500 cuando diferian sus offsets. Podia aceptar una franja
ambigua con un turno cuyos extremos tenian el mismo offset, aunque B05 rechazaba
esa misma franja. B05 ya detectaba gaps/folds, pero su conversion por strings
fallaba con anios de menos de cuatro digitos. El motor comun corrige ambos casos.

## Politica estricta adoptada

Se mantiene la semantica de rechazo explicito ya publicada para B05, y se extiende
a la validacion de turnos de B04. No se cambian DTOs, query, intervalos de 15
minutos ni el envelope/codigo existente de error.

| Situacion en una franja activa de la fecha evaluada                                              | Resultado                                                               |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Cada minuto, incluidos los extremos, tiene un unico instante UTC y el offset permanece constante | Convertir normalmente                                                   |
| Hora inexistente por avance del reloj (gap)                                                      | 409 AVAILABILITY_TIME_UNRESOLVABLE                                      |
| Hora repetida por atraso del reloj (fold)                                                        | 409 AVAILABILITY_TIME_UNRESOLVABLE; no elegir ocurrencia                |
| Transicion interna, aun si los extremos son univocos                                             | 409 AVAILABILITY_TIME_UNRESOLVABLE                                      |
| Dia local omitido (p. ej. Apia 2011-12-30) con franja activa                                     | 409 AVAILABILITY_TIME_UNRESOLVABLE                                      |
| Franjas univocas antes/despues del salto                                                         | Operar normalmente, usando el offset de esa fecha                       |
| Sin franjas activas de ese dia                                                                   | GET slots: 200 con data vacio; B04: no cubre turnos de ese dia          |
| Zona persistida invalida, offset numerico o TIME legado con segundos                             | 500 INTERNAL_ERROR: corrupcion/configuracion, no situacion DST conocida |

La politica afecta **toda la fecha evaluada** si cualquiera de sus franjas activas
es irresoluble; nunca se devuelve un listado parcial. Incluye el limite final,
aunque los intervalos de ocupacion sean semiabiertos. No se mueven horas al
siguiente instante valido, se recortan franjas ni se unen franjas adyacentes.
El rechazo tambien alcanza un turno que no cruza personalmente la transicion
si otra parte de la disponibilidad activa de esa misma fecha es irresoluble.
Es una limitacion de producto deliberada para conservar el contrato y evitar
elegir silenciosamente una politica diferente para cada endpoint.

Ejemplos en America/New_York:

- 2026-03-08 02:00 no existe. 00:00–04:00 y 01:00–02:00 se rechazan.
- 2026-11-01 01:30 ocurre dos veces. 01:00–02:00 y 00:00–04:00 se rechazan.
- 2026-03-08 03:00–04:00 se convierte a 07:00–08:00 UTC.
- 2026-11-01 02:00–03:00 se convierte a 07:00–08:00 UTC.

## Aplicacion en B04 y B05

B04 permite guardar una semana recurrente sin intentar validar todas las fechas
futuras. GET de reglas sigue devolviendo HH:mm sin convertirlos. En PUT, para cada
turno vigente del negocio se obtiene su fecha local y se resuelven las franjas
activas propuestas de esa fecha. Fechas locales distintas entre inicio y fin,
o falta de cobertura en una unica franja, producen 409 AVAILABILITY_CONFLICT.
Si esa fecha tiene una franja irresoluble, se propaga 409
AVAILABILITY_TIME_UNRESOLVABLE antes de escribir. La transaccion conserva reglas,
turnos y eventos ante rechazo. Cerrar un dia con turnos vigentes sigue siendo
AVAILABILITY_CONFLICT, aunque estos atraviesen una transicion.

B05 resuelve todas las franjas activas de la fecha solicitada antes de consultar
ocupacion. Usa exactamente el mismo motor que B04. En franjas resueltas, la
duracion representa minutos transcurridos reales; al ser constante el offset,
coincide con los minutos locales. Cada grilla se ancla al inicio de su franja,
sin unir intervalos adyacentes; resultados unicos y ordenados en UTC ISO 8601.
Un dia local puede mapear al dia UTC anterior/siguiente; el weekday siempre se
elige por la fecha local solicitada. La ocupacion se sigue consultando en bloque
por tenant/rango, con precision de milisegundos y estados SCHEDULED/CONFIRMED.

El cache de ventanas vive solo durante una evaluacion (PUT o GET); B04 reutiliza
la conversion para turnos del mismo dia sin compartir cache entre tenants o
requests. No se agregan consultas por slot ni dependencias de terceros.

## Integracion pendiente con Agenda/C y A

- Agenda debe adoptar esta politica y reutilizar el motor, sin su propia
  desambiguacion DST ni conversion desde HH:mm con la zona del proceso.
- Crear/reprogramar debe revalidar la fecha, servicio activo/duracion, franjas,
  estados bloqueantes y exclusiones dentro de la transaccion. Un slot consultado
  no garantiza que siga libre al reservar (D07).
- D07: acordar bloqueo comun por negocio con B04 y cambios de servicio/timezone.
  No basta con que B04 bloquee Business si C no sigue el mismo protocolo.
- A debe mantener una zona IANA valida y acordar la restriccion de cambios de zona
  cuando existen turnos vigentes. No se implementa ese cambio en esta tarea.
- Mantener runtimes con ICU/tzdata compatibles/actualizados: las reglas IANA
  pueden cambiar por decisiones locales. No se persisten offsets calculados.
- Si el producto requiere operar dentro de folds/gaps, sera una revision explicita
  de D06 y de estos contratos; no queda como comportamiento implicito pendiente.
- D08 (escrituras directas a Supabase) sigue pendiente, independiente de D06.

## Verificacion

Unitarias e integracion HTTP/PostgreSQL cubren Nueva York (gap/fold), Lord Howe
(saltos de 30 minutos), La Habana (transiciones a medianoche), Apia (dia omitido),
Buenos Aires (sin DST actual), Kathmandu (+05:45), Kiritimati (+14) y Pago Pago (-11).
Incluyen precision de limites, fechas UTC distintas, duplicados, estados,
aislamiento, conservacion de turnos/eventos y rollback en B04.

Se usa una base PostgreSQL local descartable con las migraciones existentes;
FakeVerifier y conexion postgres no certifican tokens reales ni RLS. No se usa
Supabase Cloud. Comandos desde la raiz: `npm test`,
`npm run test:integration --workspace=apps/backend`, `npm run lint`,
`npm run typecheck` y `npm run format:check` (ademas del formato de archivos tocados).
