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
