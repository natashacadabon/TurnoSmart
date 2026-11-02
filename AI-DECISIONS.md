# AI-DECISIONS.md - TurnoSmart

Este archivo registra decisiones relevantes de producto, arquitectura e implementacion tomadas por el equipo con asistencia de ChatGPT/Codex. La IA funciono como herramienta de analisis y desarrollo; la seleccion, validacion y responsabilidad final de cada decision corresponden al equipo de TurnoSmart.

## 2026-09-22 - Alcance y arquitectura del MVP

**Problema abordado**  
Definir una base tecnica viable para un piloto SaaS de gestion de turnos que pueda evolucionar sin sumar complejidad prematura.

**Prompt / herramienta utilizada**  
ChatGPT/Codex. Se solicito elaborar e implementar el plan inicial de TurnoSmart a partir del one-pager del producto.

**Codigo / arquitectura propuesta por IA**  
Monorepo con frontend Next.js, React y TypeScript; API REST con Node.js, Express y TypeScript; PostgreSQL y autenticacion mediante Supabase; Prisma como ORM; y un paquete compartido para tipos y logica comun. Se definieron Vercel para el frontend y Azure App Service para el backend como destinos previstos de despliegue.

**Validacion y correccion humana**  
El equipo mantuvo el stack indicado en el documento de producto y acoto el trabajo a un piloto de ocho semanas. Se priorizaron agenda, clientes, servicios, disponibilidad, turnos, recordatorios y riesgo de no-show. Funciones como WhatsApp, pagos, lista de espera y analitica avanzada quedaron fuera del MVP.

**Resultado**  
Decision aceptada como arquitectura base. El repositorio se organizo en `apps/frontend`, `apps/backend`, `packages/shared`, `docs`, `infra` y `tests`.

---

## 2026-09-22 - Riesgo de no-show explicable

**Problema abordado**  
Incorporar inteligencia al producto sin delegar una decision operativa sensible a un modelo generativo opaco.

**Prompt / herramienta utilizada**  
ChatGPT/Codex. Se analizaron el alcance del score de riesgo y el rol adecuado de Gemini dentro del MVP.

**Codigo / arquitectura propuesta por IA**  
Calcular una primera version del score mediante reglas auditables: historial de ausencias, cancelaciones tardias, anticipacion de la reserva, dia y horario, primera visita y reprogramaciones recientes. Persistir el resultado y utilizar Gemini para redactar explicaciones y recomendar acciones.

**Validacion y correccion humana**  
El equipo decidio que Gemini no sera la unica fuente de clasificacion ni tomara decisiones automaticas. Las recomendaciones deben poder relacionarse con factores observables y la accion final queda en manos del usuario.

**Resultado**  
Decision aceptada. El enfoque inicial es heuristico, explicable y asistido por IA; un modelo predictivo propio queda como evolucion posterior.

---

## 2026-09-22 - Monorepo y controles de calidad

**Problema abordado**  
Mantener consistencia entre frontend, backend y codigo compartido desde el inicio del proyecto.

**Prompt / herramienta utilizada**  
ChatGPT/Codex. Se solicito crear la base del proyecto y luego auditar los Git hooks del monorepo.

**Codigo / arquitectura propuesta por IA**  
Uso de npm workspaces, ESLint, Prettier, Husky, lint-staged y Commitlint. El flujo local incorpora validaciones en `pre-commit`, `commit-msg`, `pre-push` y `pre-merge-commit`, con scripts comunes en el `package.json` raiz.

**Validacion y correccion humana**  
El equipo aprobo centralizar los comandos y conservar configuraciones especificas por aplicacion cuando el framework lo requiere. Los hooks deben ejecutar herramientas instaladas en el proyecto y evitar depender de instalaciones globales.

**Resultado**  
Decision implementada como base de calidad del repositorio. Su cobertura debera crecer junto con los tests unitarios, de integracion y end-to-end.

---

## 2026-09-22 - Entorno de desarrollo con Docker

**Problema abordado**  
Permitir que frontend y backend se ejecuten de forma reproducible durante el desarrollo, con recarga automatica y sin duplicar instalaciones innecesariamente.

**Prompt / herramienta utilizada**  
ChatGPT/Codex. Se solicito auditar el entorno Docker de desarrollo y detectar mejoras.

**Codigo / arquitectura propuesta por IA**  
Un unico `Dockerfile.dev` para el monorepo y Docker Compose con servicios separados para frontend y backend, montaje del workspace, volumen persistente para `node_modules`, cache de Next.js y puertos `3000` y `4000`.

**Validacion y correccion humana**  
Se mantuvo Docker como entorno de desarrollo, no como definicion final de produccion. La imagen instala las dependencias del workspace y cada servicio ejecuta su propio comando de desarrollo.

**Resultado**  
Decision implementada en `infra/docker`. La configuracion de secretos y las imagenes optimizadas de produccion permanecen fuera de este alcance.

---

## 2026-09-22 - Persistencia multi-tenant con Prisma y Supabase

**Problema abordado**

Definir una base de datos versionada para el MVP y proteger el aislamiento entre negocios sin inventar un flujo de autenticacion todavia inexistente.

**Prompt / herramienta utilizada**

ChatGPT/Codex. Se solicito auditar y completar exclusivamente Prisma, PostgreSQL, Supabase, migraciones, seed y politicas RLS para el Checkpoint 1.

**Codigo / arquitectura propuesta por IA**

Schema Prisma con `Business` como raiz del tenant, `businessId` en las entidades operativas, relaciones compuestas para impedir referencias cruzadas, migracion inicial separada de la migracion RLS y un seed idempotente. `DATABASE_URL` se reserva para runtime y `DIRECT_URL` para migraciones.

**Validacion y correccion humana**

El equipo aprobo no crear usuarios ficticios de Supabase Auth. `Profile.id` debe corresponder a un usuario real de `auth.users`; el seed solo crea el perfil cuando recibe `SEED_AUTH_USER_ID`. Se verificaron las dos migraciones aplicadas, RLS activo en las nueve tablas y los datos demo cargados en Supabase.

**Resultado**

Decision implementada y validada. El aislamiento esta protegido en la base para accesos autenticados, pero el futuro backend tambien debera filtrar por `businessId` porque una conexion propietaria de Prisma puede omitir RLS.

---

## 2026-10-21 - Backend de identidad, clientes e IA (Desarrollador A)

**Problema abordado**

Implementar el alcance P0 del Desarrollador A (A01-A08 y C07): contratos comunes, API testeable, autenticacion, onboarding, clientes, historial de eventos y explicacion de riesgo con Gemini.

**Prompt / herramienta utilizada**

Claude Code, a partir del plan del Checkpoint 2. Desarrollado primero en un repositorio de trabajo propio (`turnosmart11`) y portado a este repositorio el 2026-10-26.

**Codigo / arquitectura propuesta por IA**

- Tokens validados con `supabase.auth.getUser`. Alternativa descartada: verificar el JWT localmente con JWKS (menos latencia, pero no detecta usuarios eliminados).
- Onboarding idempotente usando la PK de `Profile` y capturando `P2002`. Alternativa descartada: lock de fila con `SELECT ... FOR UPDATE`.
- Gemini con salida JSON estructurada validada con Zod y un solo reintento por formato invalido. Alternativas descartadas: texto libre; reintentos con backoff (convierten una falla en mas consumo).
- Solo factores agregados en el prompt (`sanitizeFactors`). Alternativa descartada: enviar contexto del turno.

**Validacion y correccion humana**

- Yael levanto el entorno local, inicio sesion, hizo el onboarding, cargo un cliente y verifico una explicacion real de `gemini-3.5-flash-lite` con una clave Free.
- **Correccion del tono de Gemini:** la instruccion original pedia "espanol rioplatense" y el modelo respondio con lunfardo y expresiones despectivas sobre el cliente. Lo detecto Yael en la prueba real; se cambio por "espanol claro y profesional, tono cordial, voseo permitido, sin vulgaridades, numeros en cifras" y se valido con una nueva llamada real.
- Revision de codigo por B pendiente.

**Resultado**

Implementado y probado con tests unitarios (fakes en memoria) y de integracion contra PostgreSQL real, incluido un onboarding con 5 requests concurrentes que crea un unico negocio.

---

## 2026-10-26 - Adaptacion del backend de A al schema del equipo

**Problema abordado**

El codigo de A se habia escrito contra un schema propio. Este repositorio ya tenia schema, migraciones con RLS y tooling (ESM, ESLint, Prettier, `exactOptionalPropertyTypes`), que son la fuente de verdad.

**Prompt / herramienta utilizada**

Claude Code. Se pidio portar el backend de A (A01-A08 y C07) adaptado al schema del equipo, conservando el frontend existente.

**Codigo / arquitectura propuesta por IA**

- Se conservaron el schema y las migraciones del equipo; no se agrego ninguna migracion.
- `Profile.email` es obligatorio: el onboarding lo toma del usuario de Supabase Auth y responde 422 si la cuenta no tiene email.
- `AppointmentEvent` no tiene `fromStatus`, `toStatus` ni `actorId`: se quitaron del DTO y `type` usa el enum `AppointmentEventType`. Esos datos, si C los registra, viajan en `metadata`.
- `@turnosmart/shared` pasa a ESM con imports `.js`; los scripts raiz compilan `shared` antes que los workspaces que lo consumen.
- Helper `omitUndefined` para PATCH parciales bajo `exactOptionalPropertyTypes`. Alternativa descartada: relajar la opcion del compilador.
- El arranque sigue en `src/index.ts` para no cambiar los scripts `dev` y `start`.

**Validacion y correccion humana**

Yael decidio conservar por ahora el frontend del equipo y portar solo backend, workflow de deploy y documentacion. Verificado: lint, typecheck, build, tests unitarios y de integracion contra una base PostgreSQL local con las migraciones del equipo, y smoke del build compilado (`/health`, `/ready`, 401 en `/api/me` sin token).

**Resultado**

Backend de A disponible en este repositorio. Pendientes: frontend (login, onboarding, clientes, historial y panel de explicacion), E2E (A09) y revision de B.

---

## 2026-10-26 - Pantallas de A sobre el frontend del equipo

**Problema abordado**

Sumar las pantallas de A (login, onboarding, negocio, clientes, historial y explicacion de riesgo) sin reemplazar el frontend existente ni su tema.

**Prompt / herramienta utilizada**

Claude Code. Se pidio integrar las pantallas de A al frontend del equipo (opcion 1), usando su `providers.tsx` y `theme.ts`.

**Codigo / arquitectura propuesta por IA**

- El dashboard de `/` queda intacto. Las rutas de A viven en `src/app/(app)`, `login` y `onboarding`.
- `AuthProvider` se monta en `providers.tsx` y tolera la falta de variables de Supabase, para que `/` siga funcionando sin configurarlas.
- Se descarto el tema propio de A (verde, claro/oscuro) y su layout con drawer. Por pedido de Yael, toda la app usa el diseño del dashboard de `/`: su sidebar se extrajo a `components/AppSidebar.tsx` (mismo markup, estilos y secciones Agenda, Clientes, Predicciones IA y Reportes) y lo usan tanto `page.tsx` como el layout de las pantallas con sesion. Abajo del sidebar se agregaron la cuenta, "Negocio" y "Cerrar sesion" (o "Ingresar" sin sesion). Encabezados, tarjetas y botones siguen el mismo formato. El unico cambio en `page.tsx` es reemplazar su `<aside>` por ese componente. Despues, a pedido de Yael, el dashboard con datos de ejemplo se movio sin cambios a `/demo` (`app/demo/page.tsx`) y `/` paso a ser la agenda real (`app/(app)/page.tsx`): mismo diseño y clases CSS, pero solo datos reales y estados vacios donde todavia no hay turnos.
- La configuracion de ESLint del equipo (React Compiler) marco `setState` dentro de efectos. Se corrigio en lugar de desactivar la regla: carga de datos con estado solo en callbacks, ajuste de estado durante el render, `useSyncExternalStore` para la zona horaria y el dialogo de cliente montado al abrirse.
- El historial muestra los tipos del enum `AppointmentEventType`; estado anterior/nuevo solo si C los guarda en `metadata`.

**Validacion y correccion humana**

Yael eligio esta opcion frente a reemplazar el frontend. Verificado: lint, typecheck, build y E2E 3/3 sin mocks contra Supabase local (incluye onboarding de una cuenta nueva, alta con error de validacion, recarga, edicion y logout), y revision visual en escritorio y movil.

**Resultado**

Pantallas de A integradas. Pendiente: enlace desde la agenda a `/appointments/[id]` (C) y revision de B.

---

## 2026-10-26 - Baja de clientes

**Problema abordado**

El ABM de clientes solo permitia alta y edicion. Se pidio completar la baja sin perder la consistencia con los turnos.

**Prompt / herramienta utilizada**

Claude Code. Se pidio agregar la baja de clientes al CRUD existente.

**Codigo / arquitectura propuesta por IA**

- `DELETE /api/customers/:id` con baja definitiva, sin migraciones nuevas.
- Un cliente con turnos no se borra: el schema define la relacion turno → cliente con `onDelete: Restrict`. La API responde 409 `CUSTOMER_HAS_APPOINTMENTS`, verificando antes los turnos y capturando `P2003` si se crea uno en el medio.
- Solo OWNER y ADMIN pueden eliminar (permiso `customers:delete`); STAFF sigue dando de alta y editando.
- En la pantalla, boton "Eliminar" por fila con dialogo de confirmacion.
- Alternativa descartada: baja logica (archivar), porque requiere un campo y una migracion nuevos en el schema compartido. Queda como opcion si se necesita ocultar clientes con turnos.

**Validacion y correccion humana**

Yael detecto que el CRUD estaba incompleto. Verificado con tests unitarios (204, 403, 404 entre negocios y 409), integracion contra PostgreSQL con un turno real y el recorrido E2E con baja.

**Resultado**

Implementado.

---

## 2026-10-30 - B03: gestion de servicios y revision de arquitectura

**Problema abordado**

Implementar el CRUD de servicios con aislamiento entre negocios y evaluar si
`routes.ts` requiere separar controllers y logica de negocio.

**Prompt / herramienta utilizada**

Codex. Se solicito implementar B03 respetando B01 y los componentes de A, con
revisiones puntuales de `backend-architect` y `security-reviewer`. Luego se pidio
evaluar la arquitectura sin modificar archivos y registrar la decision.

**Codigo / arquitectura propuesta por IA**

- `GET /api/services`, `POST /api/services` y `PATCH /api/services/:id` con schemas
  estrictos compartidos, filtros, paginacion y proyeccion explicita a `ServiceDto`.
- Autenticacion y contexto de A reutilizados. Lectura OWNER/ADMIN/STAFF y escritura
  OWNER/ADMIN mediante la matriz de permisos existente; tenant exclusivamente del
  contexto autenticado. El repositorio Prisma filtra por negocio y actualiza con
  la clave compuesta `(id, businessId)`.
- Unicidad por negocio, incluidos inactivos, respaldada por la restriccion existente;
  `P2002` se traduce a `SERVICE_NAME_CONFLICT` (409). Desactivacion sin borrado ni
  cambios en reservas o eventos.
- Conservar `routes.ts` y `repository.ts`, siguiendo los patrones de identidad y
  clientes de A. Las rutas contienen handlers HTTP, validacion, defaults simples y
  serializacion; no hay reglas de negocio complejas que justifiquen `service.ts`.
- Alternativa evaluada: extraer solo `controller.ts` para dejar rutas declarativas.
  Es opcional para organizar el codigo, pero actualmente aporta poco a las pruebas,
  que ya ejercitan los handlers mediante HTTP. No se realizo ese refactor.
- Considerar `service.ts` cuando existan reglas aprobadas que coordinen servicios,
  disponibilidad y reservas; evitar una capa que solo delegue al repositorio.

**Validacion y correccion humana**

La desarrolladora aprobo expresamente para B03 reutilizar los errores y middleware
de A, agregar unicamente `SERVICE_NAME_CONFLICT` al registro de errores y aplicar
los campos, limites, filtros y envelopes de servicios de B01. Esto conserva los
codigos `NOT_FOUND`, `TOKEN_INVALID` y `PROFILE_REQUIRED`, los detalles opcionales
de A y JSON malformado con respuesta 422; no implica aprobar todo B01.

La implementacion se verifico con lint, typecheck, build del backend, 70 pruebas
unitarias y 9 de integracion HTTP aprobadas. Las pruebas HTTP usan un repositorio
en memoria; las del repositorio Prisma usan dobles. No certifican persistencia ni
RLS en PostgreSQL. El formato de los archivos de B03 y `git diff --check` pasaron;
el chequeo global de formato detecto CRLF preexistentes en cuatro archivos sin
cambios respecto de HEAD: B01, Compose, README de shared y README raiz.

La revision arquitectonica posterior fue estatica, con `backend-architect`; no
modifico archivos ni volvio a ejecutar pruebas. No se encontraron defectos que
requieran refactorizar. La solicitud de registrar esta evaluacion no se toma como
aprobacion de decisiones pendientes ni de cambios funcionales adicionales.

**Resultado**

B03 implementado y recomendacion de mantener la estructura actual documentada.
No se agregaron controllers ni services adicionales. D01 general sigue pendiente
de unificacion con A/C; D07 requiere acordar la concurrencia de cambios de servicio
con reservas; D08 requiere resolver las escrituras directas a Supabase que pueden
evadir los permisos Express. No se modificaron schema, migraciones, infraestructura
ni `.env`. Sin commit ni push automaticos.

---

## 2026-10-30 - B04: gestion de disponibilidad semanal

**Problema abordado**

Implementar lectura y reemplazo semanal con validacion, aislamiento de negocios
y persistencia atomica, revisando antes las decisiones pendientes sobre turnos.

**Prompt / herramienta utilizada**

Codex. Se solicito implementar B04 siguiendo B03, revisar AGENTS.md, B01,
Prisma y DTOs, agregar pruebas y ejecutar lint/typecheck/tests, sin modificar
C ni hacer commit o push. Se revisaron las ubicaciones de AGENTS.md; solo hay
uno en frontend, fuera del alcance de estos cambios.

**Codigo / arquitectura propuesta por IA**

- GET/PUT `/api/availability-rules` con rutas/repositorio, sin controllers ni
  capas de delegacion adicionales. Schemas estrictos, request/envelope y tipos
  de disponibilidad en shared; reutilizacion de AvailabilityRuleDto y errores A.
- Permisos de lectura OWNER/ADMIN/STAFF y escritura OWNER/ADMIN mediante la
  matriz existente. businessId siempre del perfil autenticado; DTO sin tenant.
- Dia 0..6, HH:mm, inicio anterior al fin, sin duplicados/solapamientos incluso
  inactivos. Adyacencia permitida, sin medianoche. TIME conserva hora/minuto
  sin conversion de zona; legado con segundos devuelve 500 sin truncarlo.
- Reemplazo por transaccion con borrado de omitidas y upsert de tuplas para
  conservar ID/createdAt. Bloqueo de Business serializa PUT del mismo negocio,
  incluso semana vacia. No hay versionado ni deteccion de edicion perdida.
- D03: comprobar turnos SCHEDULED/CONFIRMED con endsAt futuro, incluidos en
  curso, usando intervalos persistidos y timezone de Business. Rechazar 409
  AVAILABILITY_CONFLICT si no caben en una unica franja activa. Sin cambios en
  reservas ni eventos. Mantener el resto de codigos y formatos de A/B03.

**Validacion y correccion humana**

Se detecto que D03 seguia como propuesta y se consulto antes de implementar su
politica. La desarrolladora respondio expresamente: "Si, aprobar D03 para B04".
Esto no aprueba D06/D07/D08 ni modifica C. Los turnos que atraviesan cambios de
offset abortan con INTERNAL_ERROR sin escrituras hasta acordar D06; no se
inventa una conversion DST. D07 requiere que C acuerde bloqueo y revalidacion
transaccional antes de prometer exclusion entre reservas y cambios semanales.

Pasaron lint y typecheck de todo el monorepo, 157 pruebas unitarias y las 30
pruebas de integracion (incluidos B03 y A). Se verificaron permisos y aislamiento
HTTP, persistencia TIME, conservacion de identidad, rechazo D03 sin alterar
turnos/eventos, turnos en curso, rollback real despues de borrar/insertar y
reemplazos concurrentes desde semana vacia.

Las pruebas de PostgreSQL se ejecutaron contra una base descartable creada en
el contenedor Supabase local, aplicando ambas migraciones. El bootstrap auth.uid()
retornaba NULL; se usaron FakeVerifier y conexion postgres. Esta evidencia
valida API/persistencia, no tokens reales de Supabase ni RLS. La base temporal
se elimino al terminar y no se uso la base remota configurada habitualmente.

**Resultado**

B04 implementado y D03 aprobada para su alcance. Se actualizaron B01 y el README
del modulo con los limites de integracion: D06 (transiciones horarias), D07
(concurrencia con C) y D08 (acceso directo por RLS). Sin cambios en C, schema,
migraciones, infraestructura ni `.env`. Sin commit ni push.

---

## 2026-11-02 - B07: infraestructura Azure minima M1-M2, sin despliegue

**Problema abordado**

Preparar infraestructura reproducible y ZIP ejecutable del backend para una demo
temporal de costo minimo, sin crear recursos ni modificar Supabase Cloud.

**Prompt / herramienta utilizada**

Codex. Se solicito revisar instrucciones y archivos relevantes de backend, Prisma,
Docker y documentacion Azure; implementar Bicep y comandos PowerShell manuales,
validar localmente en Node 22 y no desplegar, migrar, editar .env, hacer commit/push.
Solo existe AGENTS.md en frontend, fuera del alcance de las modificaciones.

**Codigo / arquitectura propuesta por IA**

- Bicep de suscripcion crea RG temporal exclusivo con etiquetas de proyecto/cierre;
  modulo de RG contiene solo Plan Linux F1 por defecto y Web App Node 22, una
  instancia, HTTPS Only/TLS 1.2, Always On deshabilitado. B1 es opcion manual con
  aprobacion explicita, sin fallback automatico. Sin BD Azure ni servicios extra.
- Reutilizar Supabase Cloud. Parametros secure para DATABASE_URL/SUPABASE_ANON_KEY;
  sin secretos en codigo, ZIP, salidas o what-if. Gemini no se habilita en M1-M2.
- ZIP local en Docker Debian/OpenSSL 3 x64/Node 22, imagen base fijada por digest y
  npm package-lock existente. Allowlist de contexto sin .env/frontend/tests/migraciones.
  Se generan Prisma/shared/backend y se materializa shared sin enlaces workspace.
  Solo se copia el cierre de dependencias runtime, excluyendo peers opcionales
  como Prisma CLI y tooling huerfano que npm conservaba aun con omit=dev/peer.
- App Service arranca con node dist/index.js, PORT de la plataforma, sin Oryx,
  instalacion, build ni migracion remota. Scripts Validate/Preflight/WhatIf/Deploy/
  Remove separados: what-if a nivel suscripcion no crea RG y usa placeholders.
  Deploy exige aprobacion, B1 exige aprobacion adicional. Remove exige nombre
  temporal exacto y etiquetas de propiedad; comprueba inexistencia al terminar.
- Sin cambios en workflows. ZIP y plantillas compiladas quedan en build/ ignorado.
  expiresOn es informativo, no TTL ni mecanismo automatico de borrado.

**Validacion y correccion humana**

La solicitud autoriza preparar y validar M1, no desplegar ni aprobar B1. Se
verifico con Bicep CLI oficial 0.48.1 (compilacion/formato y politicas offline),
pruebas PowerShell con az simulado, build/Prisma/ZIP real en Linux Node 22.23.4 y
smoke del ZIP extraido: Prisma carga su motor (P1001 contra localhost cerrado),
shared, PORT 43127, health 200, ready 503 sin BD, auth 401 y CORS. Pasaron lint y
typecheck del monorepo y las 158 unitarias existentes bajo Node 22.

Formato verificado para archivos modificados (Prettier y Bicep format), sintaxis
PowerShell y git diff --check aprobados. El formato global detecta 44 archivos
preexistentes sin cambios respecto de HEAD; no se reformatean archivos ajenos.
ZIP verificado: 22.665.979 bytes, motor debian-openssl-3.0.x; salida build/ ignorada.

Azure CLI no esta instalada; Preflight/what-if reales, cuotas, politicas, capacidad,
configuracion Supabase y runtime administrado quedan para la ventana autorizada.
Se consultaron fuentes oficiales de Microsoft sobre ZIP, Node/PORT, SKU/regiones
y precios; referencias en infra/azure/README.md. No se uso la cuenta Azure ni BD
remota. No se cambian schema, migraciones, .env, modulos funcionales ni frontend.

**Resultado**

B07 M1-M2 preparado y validado localmente. M2 queda manual durante el checkpoint,
con validacion de F1/region/runtime previa y limpieza completa del RG. F1 tiene
cuotas/cold starts; B1 puede consumir credito mientras exista el plan, incluso
con la app detenida. Registrar costo real y cierre en docs/costs.md. Sin commit/push.

---

## 2026-11-02 - Preparacion del frontend para demo en Vercel Hobby

**Problema abordado**

Preparar el monorepo para publicar apps/frontend con costo minimo y variables
publicas correctas, sin desplegar ni agregar infraestructura Azure/paga.

**Prompt / herramienta utilizada**

Codex. Se revisaron AGENTS.md, las guias de Next incluidas en la version instalada,
workspaces, Supabase Auth, CORS, workflow y condiciones oficiales vigentes de Hobby.
Un agente independiente reviso configuracion, scripts, documentacion y fixtures,
como exige AGENTS.md de frontend, sin modificar archivos.

**Codigo / arquitectura propuesta por IA**

- vercel.json en apps/frontend declara Next.js, instalacion desde la raiz sin
  lifecycle scripts y build de shared antes de frontend; deshabilita deploys Git.
  Root Directory apps/frontend, acceso fuera de root y Node 22 requieren settings
  del proyecto; engines de frontend y lock quedan alineados, sin nuevas dependencias.
- prebuild valida los valores efectivos con el cargador de entorno propio de Next:
  exige las tres NEXT_PUBLIC, origenes HTTPS no locales y clave Supabase publica
  publishable/legacy anon. Rechaza secret/service_role y variables privilegiadas
  con prefijo publico, sin imprimir valores. JWT decode solo es guarda de formato.
- Fallback API localhost solo en development. Verificador del bundle comprueba
  las tres variables esperadas y ausencia del fallback productivo; deben cambiarse
  mediante rebuild. La deteccion de secretos completos evita el falso positivo
  del prefijo literal sb_secret_ incluido en el SDK Supabase.
- Se mantiene login por password y redirects internos; no se inventan OAuth ni
  callback. CORS requiere origen Vercel exacto y conserva Bearer/OPTIONS existentes.
  Documentados Site URL/Redirect URLs del Supabase existente y limpieza posterior.
- Workflow manual requiere confirmar elegibilidad Hobby y verifica el bundle antes
  de deploy. Las variables publicas GitHub/Vercel deben coincidir. CI usa fixtures
  HTTPS/publicas para builds sin desplegar. No se amplia el target Azure legacy.

**Validacion y correccion humana**

La solicitud autoriza preparar, no publicar. Hobby es compatible en principio con
la demo personal no comercial declarada; el titular debe confirmar condiciones de
uso y cuenta antes de publicar. No se atribuye aprobacion juridica ni alta de plan.
Si deja de ser elegible, detenerse sin upgrade/fallback automatico.

Pasaron build Next 16.4.3 y typecheck en Linux Node 22.23.4 aislado, sin copiar .env,
27 pruebas de configuracion, verificacion del JS publicado y rechazo del prebuild
real con URL localhost. Playwright/Chrome paso 3 casos de build productivo con
Auth/API simuladas: login/recarga/logout Bearer, login de rutas protegidas y
onboarding sin escrituras. Se sobreescribio la API en runtime y el navegador siguio
utilizando el valor del build. Se bloquearon requests externos inesperados.
Tambien pasaron 8 pruebas de plataforma/CORS bajo Node 22, lint y typecheck de todo
el monorepo. No se ejecuta el E2E real que requiere cuenta/Supabase de prueba.

Formato de archivos modificados y git diff --check aprobados; el formato global
detecta 42 archivos preexistentes sin cambios respecto de HEAD. No se reformatean.
La instalacion y build usaron valores ficticios; no se accedio ni modifico Cloud.
Se elimino el contenedor local temporal, conservando la imagen para reproducirlo.

**Resultado**

Frontend preparado con guia de publicacion, validacion y eliminacion en
infra/vercel/README.md. Pendientes de la ventana autorizada: settings reales de
Vercel, confirmacion Hobby, variables Production, Site URL/redirects Supabase,
CORS_ORIGIN del backend Azure y E2E con cuenta real. Sin servicios pagos/Azure
adicionales, secretos nuevos, cambios de .env reales, deploy, commit ni push.
## 2026-11-02 - B05: generacion de slots disponibles

**Problema abordado**

Consultar disponibilidad real por servicio y fecha con una agenda compartida por
negocio, aislamiento multi-tenant y conversion IANA, sin implementar reservas de C.

**Prompt / herramienta utilizada**

Codex. Se solicito implementar B05 revisando instrucciones, B01, decisiones,
Prisma y modulos B03/B04; agregar pruebas unitarias/integracion y ejecutar
lint, typecheck, formato y tests, sin commit ni push. No hay AGENTS.md aplicable
al backend/shared; el unico del repositorio esta en frontend.

**Codigo / arquitectura propuesta por IA**

- GET `/api/slots` con query estricta compartida y respuesta `{ data: SlotDto[] }`.
  Reutiliza auth/perfil/errores de A; agrega timezone al contexto autenticado y
  permiso slots:read para OWNER/ADMIN/STAFF. Tenant y zona no vienen del request.
- Rutas HTTP delgadas, servicio de coordinacion, calculador puro y repositorio
  Prisma de solo lectura. La complejidad de B05 justifica service.ts, siguiendo
  el criterio documentado en B03; no se agregan controllers de delegacion.
- Servicio activo del negocio, duracion actual completa dentro de una unica
  franja activa y comienzos cada 15 minutos anclados a esa franja. No se unen
  franjas adyacentes. Solo comienzos futuros, ordenados, UTC ISO con milisegundos.
- Ocupacion global SCHEDULED/CONFIRMED, independientemente del servicio; estados
  CANCELLED/COMPLETED/NO_SHOW no bloquean. Intervalos semiabiertos y precision de
  milisegundos. Una consulta acotada por rango/tenant para toda la ocupacion,
  incluyendo turnos que comienzan antes del dia; sin consultas por slot.
- Exclusion para reprogramar solo de turno del tenant, del mismo servicio,
  pendiente/confirmado y no comenzado. Se agregan los codigos 409 previstos por
  B01 sin modificar los errores/envelopes existentes de A.
- D06: conversion estricta con Intl/IANA, sin nueva dependencia. No se elige
  entre ocurrencias ambiguas ni se desplazan horas inexistentes. Cualquier
  franja activa afectada rechaza toda la consulta con 409
  AVAILABILITY_TIME_UNRESOLVABLE. Se verifica tambien el interior de las franjas,
  cambios de 30 minutos y dias omitidos. Franjas univocas antes/despues funcionan.
  Es una guarda conservadora, no una aprobacion de politica DST definitiva.

**Validacion y correccion humana**

La solicitud autoriza implementar B05 con agenda compartida e intervalo de 15
minutos; no se considera aprobacion global de B01 ni de D06/D07/D08. D06 permanece
pendiente de acuerdo A/C para ofrecer horarios durante transiciones. B04 conserva
su rechazo previo para turnos que cruzan cambios de offset.

Pasaron 177 pruebas unitarias y 55 de integracion del backend, incluidas 20
unitarias nuevas y 25 de integracion B05 (14 HTTP con fakes, 11 API/PostgreSQL).
Cubren solapamientos, estados, limites, servicios inactivos, exclusion, auth,
aislamiento, DST y conservacion de turnos/eventos. Se utilizo PostgreSQL local
descartable con ambas migraciones y bootstrap auth.uid() que retorna NULL;
FakeVerifier y conexion postgres no certifican autenticacion Supabase ni RLS.
Los primeros intentos HTTP fallaron por EACCES del sandbox; la repeticion con
acceso localhost paso. No se utilizo la base remota ni se modifico .env.

Lint y typecheck de todo el monorepo aprobados. Prettier aplicado y comprobado
en todos los archivos de B05; git diff --check aprobado. El chequeo global
de formato detecta 34 archivos preexistentes sin cambios respecto de HEAD,
fuera del alcance de B05; no se reformatearon. La base temporal de pruebas
se elimino al finalizar.

**Resultado**

B05 implementado sin crear/modificar reservas, schema ni migraciones. Contrato
y limites documentados en B01 y README de slots. D07 sigue pendiente: C debe
revalidar servicio/duracion/timezone/franjas/ocupacion dentro de la transaccion y
acordar serializacion por negocio con B04, cambios de servicios y de timezone.
La consulta no bloquea ni promete snapshot consistente o disponibilidad al
reservar; la exclusion consultada tampoco autoriza una reprogramacion futura.
D08 sigue pendiente para accesos directos a Supabase. Sin commit ni push.

---

## Pendientes con docentes (A10)

- [ ] Se acepta CD con disparo manual (`workflow_dispatch`) como "despliegue continuo"? Registrar respuesta y fecha.
- [ ] Cuando puede cerrarse el entorno cloud de la demo del 09/11?
- [ ] Se acepta demo local ante una caida externa, con validacion cloud posterior?

Consulta enviada: _fecha, canal_ · Respuesta: _fecha, quien respondio, texto resumido_

---

## Plantilla para nuevas decisiones

### YYYY-MM-DD - Titulo de la decision

**Problema abordado**  
Describir el desafio tecnico, funcional o de arquitectura.

**Prompt / herramienta utilizada**  
Indicar la herramienta y resumir la instruccion utilizada. No es necesario copiar prompts extensos.

**Codigo / arquitectura propuesta por IA**  
Resumir la solucion, las alternativas consideradas y el alcance de la propuesta.

**Validacion y correccion humana**  
Indicar que se verifico, que se descarto, que se modifico y por que.

**Resultado**  
Registrar el estado final y, cuando exista, la evidencia asociada: archivo, prueba, commit, pull request o despliegue.
