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
