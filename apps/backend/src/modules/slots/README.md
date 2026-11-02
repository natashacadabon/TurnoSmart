# B05 — Slots disponibles

`GET /api/slots` recibe date (YYYY-MM-DD), serviceId (UUID) y opcionalmente
excludeAppointmentId. Conserva el contrato compartido, la autenticacion y el
permiso slots:read para OWNER/ADMIN/STAFF. El negocio/timezone provienen del
contexto autenticado; todas las consultas operativas filtran por negocio.

- routes.ts valida HTTP; service.ts coordina las lecturas; calculator.ts calcula
  slots sin HTTP/base de datos; repository.ts consulta Prisma sin escribir.
- `lib/business-time.ts` resuelve las franjas UTC y es el mismo motor que B04.
- Cada franja activa ancla su grilla de 15 minutos. El servicio completo debe
  caber dentro de una unica franja; no se unen franjas adyacentes.
- La agenda es compartida por negocio: SCHEDULED/CONFIRMED de cualquier servicio
  bloquean. La ocupacion semiabierta se consulta una vez por rango de fechas,
  incluyendo turnos iniciados antes del rango y conservando milisegundos.
- Solo inicios futuros, unicos y ordenados. Respuesta `{ data: SlotDto[] }` con
  startsAt/endsAt UTC ISO 8601; no expone datos de clientes ni modifica reservas.
- La exclusion requiere turno del mismo negocio/servicio, futuro y
  SCHEDULED/CONFIRMED. Se mantienen los errores 404/409 de B05.

## D06 resuelta para B04/B05

Se adopta la politica estricta: si alguna franja activa de la fecha contiene
horas ambiguas/inexistentes o un cambio de offset (incluidos ambos limites),
toda la consulta responde 409 `AVAILABILITY_TIME_UNRESOLVABLE`. No hay resultados
parciales, conversiones desplazadas ni eleccion de ocurrencias repetidas.
Las franjas univocas antes/despues de una transicion funcionan normalmente.
La fecha UTC puede ser anterior/posterior a la fecha local solicitada.

Se reutiliza el codigo 409 ya publicado; no cambian query, DTO ni envelope.
Zona persistida invalida, offset numerico o TIME con segundos siguen siendo
500 `INTERNAL_ERROR`, por configuracion invalida. Detalles, auditoria y ejemplos:
[politica D06](../../../../../docs/timezones-dst.md).

## Integracion pendiente

Agenda/C debe adoptar la misma politica y revalidar dentro de la transaccion;
consultar un slot no lo reserva. D07 requiere acordar serializacion comun por
negocio con B04 y cambios de servicio/timezone. La restriccion de cambios de
timezone de A y D08 (accesos directos a Supabase) tambien siguen pendientes.
No se implementa ni modifica Agenda en esta tarea.

Pruebas: slots.test.ts, slots-http.test.ts, slots-db.test.ts y las suites nuevas
business-time.test.ts/dst-db.test.ts. La integracion requiere PostgreSQL local
descartable con migraciones existentes; FakeVerifier/postgres no certifican RLS.
