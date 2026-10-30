# B01 - Contratos de servicios, disponibilidad y slots

Estado: **propuesta para revision**.

### Modelo real y limites del contrato

| Modelo           | Campos utilizados                                                                            | Restricciones existentes                                            | Reglas adicionales de API propuestas                                |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Business         | id, timezone                                                                                 | timezone String, default America/Argentina/Buenos_Aires             | Validar zona IANA; obtenerla del negocio autenticado                |
| Profile          | id, businessId, role                                                                         | OWNER, ADMIN, STAFF; pertenece a un negocio                         | Validar token y resolver perfil/rol desde servidor                  |
| Service          | id, businessId, name, description, durationMinutes, priceCents, active, createdAt, updatedAt | Nombre unico por negocio; duracion > 0; precio null o >= 0          | Limites de texto y duracion; desactivacion sin borrado              |
| AvailabilityRule | id, businessId, dayOfWeek, startTime, endTime, active, createdAt, updatedAt                  | Dia 0..6; TIME(0); inicio < fin; tupla negocio/dia/inicio/fin unica | Precision de minutos, no solapar franjas, reemplazo semanal atomico |
| Appointment      | id, businessId, serviceId, customerId, startsAt, endsAt, status                              | TIMESTAMPTZ(3), inicio < fin; FK compuestas por negocio             | Ocupacion global por negocio, sin solapamientos concurrentes        |

## 2. Tabla de endpoints y responsabilidades

Todas las rutas son relativas a la base de la API. No incluyen businessId en path, query ni body.

| Metodo y ruta               | Objetivo                                               | Permisos propuestos | Responsable B                          | Dependencias                                                            |
| --------------------------- | ------------------------------------------------------ | ------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| GET /api/services           | Listar catalogo con filtro de actividad                | OWNER, ADMIN, STAFF | Listado y DTO de servicios             | Modulo autenticación: contexto y acceso                                 |
| POST /api/services          | Crear servicio                                         | OWNER, ADMIN        | Validacion, unicidad y alta            | Modulo autenticación: contexto y autorizacion                           |
| PATCH /api/services/:id     | Editar o desactivar servicio                           | OWNER, ADMIN        | Cambios parciales y reglas de duracion | Autenticación: acceso; Modulo Turnos: no alterar turnos existentes      |
| GET /api/availability-rules | Leer configuracion semanal completa                    | OWNER, ADMIN, STAFF | Serializar dias y horas locales        | Autenticacion: contexto/timezone                                        |
| PUT /api/availability-rules | Reemplazar configuracion semanal completa              | OWNER, ADMIN        | Validacion y reemplazo atomico         | Autenticacion: permisos; Turnos: preservar turnos y serializar cambios |
| GET /api/slots              | Consultar intervalos disponibles para servicio y fecha | OWNER, ADMIN, STAFF | Calculo de disponibilidad              | Autenticacion: contexto/timezone; Turnos: ocupacion y reprogramacion    |

**En esta primera instancia no se aceptan varias agendas por negocio. El negocio tendrá una única agenda compartida, con capacidad para atender un solo turno a la vez, independientemente de la cantidad de empleados o servicios que ofrezca.**

Esto significa que:

- AvailabilityRule define los horarios de atención del negocio.
- Service define los servicios y su duración.
- Appointment representa las reservas que ocupan esa única agenda.
- GET /api/slots calcula los horarios disponibles, descontando todos los turnos que bloquean la agenda, sin importar a qué servicio pertenecen.

## 3. Convenciones comunes

### Autenticacion, autorizacion y tenant

- Header `Authorization: Bearer <access_token>` emitido por Supabase Auth.
- El modulo de autenticación valida el token y obtiene el usuario. El perfil existente determina businessId y role; Business determina timezone. No confiar en roles o negocio enviados por el navegador ni
  decodificar el token sin verificarlo.
- Aislamiento entre negocios (tenant): cada usuario solo puede consultar y modificar datos de su propio negocio. El businessId se obtiene del servidor, nunca de valores enviados por el frontend.

#### Errores

| Código | Significado                                                 |
| ------ | ----------------------------------------------------------- |
| `401`  | No iniciaste sesión o el token es inválido.                 |
| `403`  | No tenés permisos o un negocio asociado.                    |
| `404`  | El recurso no existe o pertenece a otro negocio.            |
| `422`  | Enviaste datos no permitidos, como un businessId adicional. |
| `500`  | Hay una inconsistencia interna en los datos.                |

### JSON y serializacion

- Request con body: `Content-Type: application/json`. Respuesta: JSON con nombres camelCase.
- Resultado individual: `data` contiene el objeto.
  - `data`: contiene el objeto solicitado o un array si es una lista.
  - `meta`: contiene información adicional, como cantidad de resultados o paginación.
  - `error`: contiene los detalles del error cuando la operación falla.
- UUID en formato UUID, sin imponer exclusivamente version 4. Timestamps de salida UTC, ISO 8601, milisegundos y sufijo Z. Campos nullable se devuelven como null, no se omiten.
- DTOs: son los objetos que la API envía al frontend. Pueden incluir información calculada (total, generatedAt, slotIntervalMinutes) que no existe como columna en Prisma. No se expone businessId.
- Campos protegidos: id, createdAt y updatedAt son generados por el servidor y no pueden modificarse desde el frontend.
- Validación: se rechazan tipos incorrectos, campos desconocidos, valores fuera de rango y parámetros de consulta repetidos o no permitidos. Los datos inválidos devuelven 422.

### Errores comunes

| HTTP | Codigo estable                                               | Cuando aplica                                                     |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| 400  | INVALID_JSON                                                 | Body JSON mal formado                                             |
| 401  | UNAUTHENTICATED                                              | Token ausente, invalido o vencido                                 |
| 403  | BUSINESS_CONTEXT_REQUIRED / FORBIDDEN                        | Falta de perfil/negocio o permiso                                 |
| 404  | RESOURCE_NOT_FOUND                                           | Recurso inexistente o de otro negocio                             |
| 409  | SERVICE_NAME_CONFLICT                                        | Nombre normalizado ya usado en el negocio                         |
| 409  | SERVICE_INACTIVE                                             | Servicio desactivado al consultar slots o reservar                |
| 409  | AVAILABILITY_CONFLICT                                        | Cambio semanal invalida un turno vigente                          |
| 409  | APPOINTMENT_NOT_RESCHEDULABLE / APPOINTMENT_SERVICE_MISMATCH | Exclusion de turno no compatible con reprogramacion               |
| 409  | AVAILABILITY_TIME_UNRESOLVABLE                               | Frontera horaria local ambigua/inexistente en la fecha solicitada |
| 415  | UNSUPPORTED_MEDIA_TYPE                                       | Body enviado con un tipo de contenido no admitido                 |
| 422  | VALIDATION_ERROR                                             | Formato, rango, campos desconocidos o reglas de input invalidas   |
| 500  | INTERNAL_ERROR                                               | Error inesperado o configuracion persistida invalida              |
| 503  | SERVICE_UNAVAILABLE                                          | Dependencia requerida temporalmente no disponible                 |

Ejemplo de validacion (422): `path` usa notacion con puntos, relativa a body o query;
`source` indica el origen. `details` siempre es un array, vacio si no aplica.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La solicitud contiene datos invalidos.",
    "details": [
      {
        "source": "body",
        "path": "durationMinutes",
        "code": "OUT_OF_RANGE",
        "message": "Debe ser un entero entre 1 y 1440."
      }
    ]
  }
}
```

Ejemplo de conflicto de nombre (409):

```json
{
  "error": {
    "code": "SERVICE_NAME_CONFLICT",
    "message": "Ya existe un servicio con ese nombre en el negocio.",
    "details": []
  }
}
```

Ejemplo de acceso a UUID ajeno o inexistente (404), sin filtrar existencia:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "El recurso solicitado no existe.",
    "details": []
  }
}
```

Nunca exponer consultas, nombres de constraints, tokens, credenciales o stack traces. El frontend
decide comportamiento por HTTP + code, no por texto del mensaje. Los fallos inesperados no deben
convertirse en un 200 con coleccion vacia. Estos errores requieren acuerdo con A01/C01 (D01).

## 4. Gestion de servicios

### DTO Service y validaciones

| Campo de entrada | POST                   | PATCH                 | Regla propuesta compatible con Prisma                                        |
| ---------------- | ---------------------- | --------------------- | ---------------------------------------------------------------------------- |
| name             | Obligatorio            | Opcional              | String trim de 1..120 caracteres; unico por negocio, incluso entre inactivos |
| description      | Opcional, default null | Opcional; null limpia | String trim hasta 2000 caracteres; vacio se normaliza a null                 |
| durationMinutes  | Obligatorio            | Opcional              | Entero JSON de 1..1440 minutos                                               |
| priceCents       | Opcional, default null | Opcional; null limpia | Entero JSON de 0..2147483647; 0 es precio cero, null es sin precio informado |
| active           | Opcional, default true | Opcional              | Boolean JSON                                                                 |

### GET /api/services

El frontend utiliza este endpoint para mostrar el catálogo de servicios de un negocio.

| Query  | Obligatorio | Default | Valores                                      |
| ------ | ----------- | ------- | -------------------------------------------- |
| active | No          | true    | true, false o all; all incluye ambos estados |
| limit  | No          | 50      | Entero 1..100                                |
| offset | No          | 0       | Entero 0..2147483647                         |

Orden estable por name ascendente y luego id ascendente, segun comparacion de PostgreSQL.
`meta.total` cuenta el conjunto del negocio que satisface el filtro, antes de paginar. Un offset
sin resultados devuelve 200 con data vacio y total real. No hay busqueda ni orden custom en P0.

Request: `GET /api/services?active=true&limit=50&offset=0`.

Response 200:

```json
{
  "data": [
    {
      "id": "20000000-0000-4000-8000-000000000001",
      "name": "Corte y peinado",
      "description": "Corte, lavado y peinado.",
      "durationMinutes": 60,
      "priceCents": 250000,
      "active": true,
      "createdAt": "2026-10-22T12:00:00.000Z",
      "updatedAt": "2026-10-22T12:00:00.000Z"
    }
  ],
  "meta": {
    "active": "true",
    "limit": 50,
    "offset": 0,
    "total": 1
  }
}
```

Codigos: 200; 422 por query invalida; errores comunes 401/403/500/503.
Dependencia: A provee tenant/rol; B no necesita endpoints de reservas para listar.

### POST /api/services

Objetivo: crear un servicio dentro del negocio autenticado. Sin query ni parametros de path.
Body conforme a la tabla de campos; no aceptar id, businessId ni timestamps.

Request body:

```json
{
  "name": "Corte y peinado",
  "description": "Corte, lavado y peinado.",
  "durationMinutes": 60,
  "priceCents": 250000,
  "active": true
}
```

Response 201:

```json
{
  "data": {
    "id": "20000000-0000-4000-8000-000000000001",
    "name": "Corte y peinado",
    "description": "Corte, lavado y peinado.",
    "durationMinutes": 60,
    "priceCents": 250000,
    "active": true,
    "createdAt": "2026-10-22T12:00:00.000Z",
    "updatedAt": "2026-10-22T12:00:00.000Z"
  }
}
```

Codigos: 201; 409 SERVICE_NAME_CONFLICT; 422 VALIDATION_ERROR; comunes 400/401/403/415/500/503.
Sin body o body vacio: 422. Se permite crear inactivo. A autoriza OWNER/ADMIN; no depende de C.

### PATCH /api/services/:id

Objetivo: modificar campos o desactivar sin borrar historia. `id`: UUID de Service; sin query.
Body parcial: al menos uno de los cinco campos editables. Omitir conserva el valor; null solo
limpia description/priceCents. El resto de validaciones es igual a POST.

Request: `PATCH /api/services/20000000-0000-4000-8000-000000000001`.

```json
{
  "durationMinutes": 45,
  "description": null,
  "active": false
}
```

Response 200:

```json
{
  "data": {
    "id": "20000000-0000-4000-8000-000000000001",
    "name": "Corte y peinado",
    "description": null,
    "durationMinutes": 45,
    "priceCents": 250000,
    "active": false,
    "createdAt": "2026-10-22T12:00:00.000Z",
    "updatedAt": "2026-10-22T13:00:00.000Z"
  }
}
```

Reglas de compatibilidad con Gestión de Turnos y Reservas:

- Editar duracion/precio no recalcula startsAt/endsAt de turnos ya existentes ni genera eventos. Modificar la duración o el precio de un servicio no altera los turnos existentes. Los horarios reservados se mantienen.
- Desactivar conserva turnos existentes y su servicio referenciado; no cancela ni borra turnos.
- Servicio inactivo no ofrece slots ni admite nuevas reservas/reprogramaciones. Se puede
  reactivar con active=true. Confirmacion/cierre de turnos previos pertenece a C.
- Una reprogramacion posterior usa la duracion actual del servicio activo y vuelve a validar
  ocupacion. Un turno existente conserva su intervalo hasta esa operacion explicita (D04).
- Modulo gestion de turnos y Modulo Servicios deben coordinar cambios de active/durationMinutes con la validacion transaccional de
  reservas para que no se reserve usando una duracion o actividad ya obsoleta (seccion 7).

Codigos: 200; 404 RESOURCE_NOT_FOUND; 409 SERVICE_NAME_CONFLICT; 422 por UUID/campos/body vacio;
comunes 400/401/403/415/500/503. No hay DELETE ni cambio de tenant.

## 5. Configuracion semanal

### DTO y representacion de reglas

- dayOfWeek: entero 0..6; 0 domingo, 1 lunes, 6 sabado.
- startTime/endTime: hora de pared local HH:mm, sin fecha, offset, segundos ni Z. Aceptar
  00:00..23:59; inicio estrictamente menor que fin. No aceptar 24:00 ni cruces de medianoche.
- Varias franjas por dia. Comparar cada par en el mismo dia: [inicio, fin) permite adyacencia,
  no solapamiento. Rechazar duplicados aunque active difiera, por la unicidad SQL existente.
- No solapar reglas del mismo dia, incluso inactivas; simplifica su reactivacion (D03).
- El esquema usa DateTime con @db.Time(0), pero la API expone HH:mm. La fecha auxiliar de un
  objeto Date del ORM no es parte del dominio: no aplicar conversion de zona a esa hora ni
  serializarla como un instante de 1970. B04 debe conservar exactamente hora/minuto locales.
- La BD admite segundos que el contrato no recibe: si existen reglas legadas con segundos
  distintos de cero, no truncarlas silenciosamente; registrar configuracion invalida y devolver
  500 INTERNAL_ERROR hasta corregirla mediante el flujo correspondiente.

### GET /api/availability-rules

Objetivo: devolver toda la semana, incluidas reglas inactivas. Sin path params, query ni body.
Orden: dayOfWeek, startTime, endTime, id, todos ascendentes. Reglas vacias no implican 24/7.

Response 200:

```json
{
  "data": {
    "timezone": "America/Argentina/Buenos_Aires",
    "rules": [
      {
        "id": "50000000-0000-4000-8000-000000000001",
        "dayOfWeek": 1,
        "startTime": "09:00",
        "endTime": "12:00",
        "active": true,
        "createdAt": "2026-10-22T12:00:00.000Z",
        "updatedAt": "2026-10-22T12:00:00.000Z"
      }
    ]
  }
}
```

timezone viene de Business; no es campo de AvailabilityRule. Para semana vacia: misma forma
con rules vacio. Codigos: 200; 422 por query desconocida; comunes 401/403/500/503.
Dependencia A: negocio/timezone; C no es necesario para leer la configuracion.

### PUT /api/availability-rules

Objetivo: reemplazar el conjunto semanal completo; no es un PATCH ni un upsert por id.
Sin parametros de path ni query. Body obligatorio con una unica propiedad rules (array 0..100).
Cada elemento exige dayOfWeek, startTime, endTime; active opcional default true. No recibe
timezone, id, businessId ni timestamps. Los limites del array son politica API propuesta (D03).

Request body:

```json
{
  "rules": [
    {
      "dayOfWeek": 1,
      "startTime": "09:00",
      "endTime": "12:00",
      "active": true
    }
  ]
}
```

Response 200: mismo DTO completo y orden de GET /api/availability-rules, incluido timezone;
para el request ilustrativo anterior, la respuesta JSON de GET es tambien un ejemplo de PUT.

Semantica del reemplazo:

1. Validar todo el payload antes de guardar. Datos invalidos no dejan cambios parciales.
2. Los dias/reglas omitidos se eliminan del conjunto; rules vacio cierra toda la semana.
   La UI debe advertir que envia la semana completa, no solo la fila editada.
3. Conservar id/createdAt de reglas cuya tupla (dayOfWeek, startTime, endTime) se mantiene;
   modificar active segun el payload. Reglas nuevas reciben id/timestamps de servidor.
   Repetir el mismo PUT no crea duplicados ni renueva IDs; updatedAt puede variar.
4. El reemplazo se aplica atomicamente, coordinado con las escrituras de reservas.
5. Todo turno del negocio SCHEDULED/CONFIRMED con endsAt posterior al instante de evaluacion
   debe seguir cabiendo en una unica franja activa del calendario propuesto. Incluye turnos
   en curso; usar sus startsAt/endsAt guardados, no la duracion actual de Service.
6. Si alguno queda fuera, rechazar el PUT completo con 409 AVAILABILITY_CONFLICT. No cancelar,
   reprogramar ni modificar eventos/turnos automaticamente. El equipo opera esos turnos en C
   antes de reducir disponibilidad. No se garantiza cancelacion automatica por esta tarea.
7. Sin version/ETag en el modelo, dos ediciones validas se serializan y prevalece la ultima
   escritura. No prometer deteccion de edicion perdida; una version seria ampliacion futura.

Ejemplo de franja invalida (422):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La solicitud contiene datos invalidos.",
    "details": [
      {
        "source": "body",
        "path": "rules.0.endTime",
        "code": "INVALID_TIME_RANGE",
        "message": "Debe ser posterior a startTime dentro del mismo dia."
      }
    ]
  }
}
```

Ejemplo de turno incompatible con una reduccion semanal (409):

```json
{
  "error": {
    "code": "AVAILABILITY_CONFLICT",
    "message": "La configuracion deja turnos vigentes fuera de disponibilidad.",
    "details": []
  }
}
```

Codigos: 200; 409 AVAILABILITY_CONFLICT; 422 por duplicados, solapamiento, horas o payload;
comunes 400/401/403/415/500/503. Duplicados/franjas del request son 422, no un conflicto SQL
publico. A autoriza OWNER/ADMIN; C aporta reglas de ocupacion y mecanismo de serializacion.

## 6. Consulta de slots

### GET `/api/slots`

Permite consultar los horarios disponibles para reservar un servicio en una fecha determinada. **Solo consulta disponibilidad, no crea ni bloquea reservas.**

| Parámetro              | Obligatorio | Descripción                                                           |
| ---------------------- | ----------- | --------------------------------------------------------------------- |
| `date`                 | Sí          | Fecha a consultar (`YYYY-MM-DD`).                                     |
| `serviceId`            | Sí          | Identificador del servicio activo.                                    |
| `excludeAppointmentId` | No          | Turno que se excluye de la ocupación al consultar una reprogramación. |

### Reglas de disponibilidad

- Los turnos pueden comenzar cada **15 minutos**, contando desde el inicio de cada franja.
- El servicio debe entrar completamente dentro del horario de atención.
- Cada negocio tiene una sola agenda: **no se permiten turnos superpuestos**, aunque sean de servicios diferentes.
- Los turnos `SCHEDULED` y `CONFIRMED` ocupan horarios. Los `CANCELLED`, `COMPLETED` y `NO_SHOW` no.
- Solo se muestran horarios futuros y disponibles, ordenados cronológicamente.
- Para reprogramar, se puede excluir el turno actual del cálculo, siempre que no haya comenzado, pertenezca al mismo servicio y siga pendiente o confirmado.
- Si no hay horarios disponibles, se devuelve `200` con `data: []`.
- Los horarios se devuelven en UTC, sin información personal de otros clientes.

**Ejemplo:** si el negocio atiende de 09:00 a 12:00, el servicio dura 60 minutos y existe un turno de 09:30 a 10:30, los comienzos disponibles son 10:30, 10:45 y 11:00.

---

## 7. Fechas y concurrencia con los módulos A y C

### Fechas y zonas horarias

- Se utiliza el `timezone` del negocio, no el del navegador.
- Los horarios semanales se expresan en hora local; los turnos se almacenan como instantes UTC.
- No se permiten solapamientos. Un turno de 09:00 a 10:00 y otro de 10:00 a 11:00 son compatibles.
- Las horas ambiguas o inexistentes por cambios de horario de verano quedan pendientes de la política D06; no se debe inventar una conversión hasta que A/C la aprueben.
- En P0 se propone impedir cambios de zona horaria cuando existen turnos vigentes.

### Responsabilidades

| Módulo                               | Responsabilidad                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| **A — Autenticación**                | Identifica al usuario, negocio, rol y zona horaria.                                |
| **B — Servicios y disponibilidad**   | Define horarios, calcula slots y administra servicios.                             |
| **C — Gestión de turnos y reservas** | Crea, cancela y reprograma turnos, verificando la disponibilidad antes de guardar. |

### Concurrencia

Consultar un horario libre **no garantiza que siga disponible al reservarlo**.

Por ejemplo, dos usuarios podrían intentar reservar las 10:00 simultáneamente.

Para evitarlo:

- C debe volver a comprobar la disponibilidad dentro de una transacción.
- B y C deben coordinar los cambios de servicios, horarios y reservas.
- Se propone bloquear temporalmente las operaciones de escritura incompatibles del mismo negocio mediante transacciones en PostgreSQL.
- Si dos usuarios intentan reservar el mismo horario, solo una reserva debe confirmarse; la otra recibe `409 APPOINTMENT_CONFLICT`.
- Si una reserva falla, no deben quedar cambios parciales.

---

## 8. Contratos compartidos (`packages/shared`)

Los contratos iniciales de lectura de B02 ya se incorporaron en `packages/shared`: `ServiceDto`, `AvailabilityRuleDto` y `SlotDto`, además de la constante `SLOT_INTERVAL_MINUTES`.

Estos tipos representan objetos de lectura y no importan modelos de Prisma ni exponen `businessId`.

Las consultas, envelopes, errores y validaciones en ejecución quedan pendientes de las tareas de implementación de endpoints.

En B01 se documentan los contratos HTTP y sus decisiones pendientes; B02 implementa únicamente estos tipos compartidos.

---

## 9. Decisiones pendientes de aprobación

Las siguientes decisiones deben acordarse con los demás módulos antes de integrar las funcionalidades.

| ID      | Decisión                                                                 |
| ------- | ------------------------------------------------------------------------ |
| **D01** | Formato de la API, errores, autenticación y permisos.                    |
| **D02** | Validaciones de servicios, nombres, precios y duración.                  |
| **D03** | Reemplazo completo de horarios semanales sin afectar turnos existentes.  |
| **D04** | Cambios en servicios no modifican turnos anteriores.                     |
| **D05** | Una agenda por negocio y comienzos cada 15 minutos.                      |
| **D06** | Manejo de fechas, UTC y zonas horarias.                                  |
| **D07** | Transacciones para evitar reservas simultáneas incompatibles.            |
| **D08** | Evitar que accesos directos a Supabase salteen los permisos del backend. |

Estas decisiones todavía son propuestas y requieren aprobación de los módulos involucrados.

---

## 10. Casos de aceptación

Se deberán realizar pruebas para comprobar que:

- Un usuario no pueda acceder a datos de otro negocio ni realizar operaciones sin permiso.
- No se permitan servicios duplicados ni datos inválidos.
- Modificar o desactivar servicios no altere turnos existentes.
- No se acepten horarios duplicados, superpuestos o inválidos.
- Los cambios en la disponibilidad no dejen turnos vigentes fuera del horario permitido.
- Los slots respeten la duración del servicio, los horarios y los turnos ocupados.
- Dos reservas simultáneas incompatibles no puedan confirmarse.
- Los errores del servidor se informen correctamente.

**Estas pruebas se implementarán en las tareas posteriores. B01 solamente define los resultados esperados.**

---

## 11. Checklist de aceptación B01

### Documentación completada

- [x] Modelos y restricciones actuales revisados.
- [x] Seis endpoints definidos con sus parámetros y respuestas.
- [x] Permisos y aislamiento entre negocios documentados.
- [x] Reglas de disponibilidad, fechas y slots especificadas.
- [x] Dependencias entre módulos identificadas.
- [x] Propuesta de contratos TypeScript compartidos documentada.

### Pendiente

- [ ] Aprobación de D01–D08 con los módulos A y C.
- [ ] Incorporar los acuerdos en la documentación.
- [ ] Validar y aceptar B01 antes de comenzar la integración.
