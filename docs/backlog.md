# Backlog de entrega final de TurnoSmart

Actualizado el **26 de noviembre de 2026** contra el repositorio y las comprobaciones registradas en [pruebas](../tests/README.md) y [operaciones](operations.md). Implementado o aprobado localmente no equivale a validado en el entorno publicado. Esta actualización documental no ejecuta despliegues ni modifica bases remotas.

## Cerrado con evidencia local

- [x] **P0-05 — Seguridad de Next.js:** Next.js 16.4.5 y tooling corregido; instalación limpia, builds en Node 22 y auditorías completa/producción sin alertas en la ejecución registrada. Pendientes publicación y formato global. [Resultados](operations.md#seguridad-de-nextjs-p0-05).
- [x] **P0-06 — Backup y recuperación PostgreSQL local:** cifrado, checksums, claves privadas, destino nuevo y aislado, errores comprobados y rollback documentado sin modificar migraciones históricas. Catorce pruebas de scripts y ocho de integración aprobadas. Backup de 3,649 s y recuperación total de 6,707 s para el fixture sintético; no es un RTO de producción ni recuperación integral de Supabase. [Evidencia](../tests/README.md#p0-06--backups-postgresql-26-de-noviembre-de-2026).
- [x] **Validación local registrada:** 248 pruebas de `npm test`, 52 de configuración frontend, lint y typecheck aprobados en Node 22. La ejecución del 25 de noviembre registra además 110 pruebas de integración PostgreSQL y 56 E2E aprobadas con una omitida. Estas E2E usan simulaciones de Auth/API y no certifican el recorrido publicado. [Alcance y fechas](../tests/README.md).

## P0 · Requisitos para cerrar la entrega

Orden sugerido: resolver formato y permisos, ensayar actualización y recuperación, publicar el candidato y ejecutar la demo. Registrar SHA, fecha, entorno y evidencia sin secretos ni datos personales. Los IDs FINAL identifican tareas de cierre y no reemplazan los IDs históricos de auditoría.

### FINAL-01 · Completar el gate de calidad

- [ ] Corregir el formato de los **77 archivos preexistentes** que bloquean `npm run format:check`, en un cambio dedicado sin alterar comportamiento.
- [ ] Sobre el candidato final y con Node 22, ejecutar `npm ci`, build shared, build frontend independiente de Prisma, generación de Prisma/build backend, lint, typecheck, `format:check`, `npm test`, tests de configuración frontend, integración PostgreSQL y E2E relevantes.
- [ ] Repetir `npm audit` y `npm audit --omit=dev` sobre el lockfile final, revisar nuevos avisos aplicables y registrar el CI del mismo SHA.

**Cierre:** comandos y CI aprobados sobre el mismo candidato, con resultados reales y omisiones justificadas. Repetir lo afectado si cambia ese candidato.

### FINAL-02 · Verificar permisos del entorno de entrega

- [ ] Inventariar permisos efectivos de Data API/RLS en clientes, servicios, disponibilidad, scores y demás tablas de dominio; corregir accesos directos que eludan las operaciones autorizadas.
- [ ] Probar aislamiento entre dos negocios, accesos `anon`/`authenticated`, roles OWNER/ADMIN global y rechazo de acciones públicas deshabilitadas.

**Cierre:** evidencia de denegación de lecturas entre negocios y escrituras no autorizadas. P0-06 verificó ACL/RLS del fixture, no los permisos de todas las tablas del proyecto Supabase real.

### FINAL-03 · Ensayar la actualización desde una versión anterior

- [ ] En un destino descartable, migrar datos de una versión anterior y comprobar horarios, confirmaciones, historial, preferencias, ocupación y cola de correo. La instalación limpia local ya está comprobada.
- [ ] Verificar el emparejamiento código/esquema: `20261112000200_appointment_notification_actions` elimina `CONFIRMED` del enum anterior, por lo que no permite rollback directo al backend antiguo.
- [ ] Preparar backup previo verificado y procedimiento de corrección hacia adelante o recuperación en un destino nuevo antes de migrar el entorno de entrega.

**Cierre:** actualización ensayada sin pérdida de datos ni preferencias, recuperación documentada y migraciones históricas intactas. [Rollback](operations.md#backup).

### FINAL-04 · Preparar recuperación integral del entorno

- [ ] Definir responsable, retención y segunda copia cifrada de backups; custodiar las claves por separado y probar la recuperación desde esa copia.
- [ ] Ensayar un destino compatible con extensiones y permisos reales, registrando integridad y tiempo. La conexión directa/session con cliente nativo real no está acreditada por el ensayo Docker local.
- [ ] Inventariar y preparar recuperación de Supabase Auth, Storage, secretos, configuración, funciones y Cron. Acordar el cambio de destino y la posible pérdida de escrituras posteriores al backup.

**Cierre:** procedimiento reproducible y límites explícitos para el entorno de entrega. P0-06 está cerrado para PostgreSQL local; un dump no recupera por sí solo todos los servicios de Supabase. [Runbook](operations.md#backup).

### FINAL-05 · Publicar y probar el candidato de entrega

- [ ] Confirmar frontend/backend de entrega y requisito académico de Azure. Usar el [procedimiento de Azure](../infra/azure/README.md) si corresponde al checkpoint.
- [ ] Publicar el candidato con los parches de seguridad, variables y migraciones verificadas; revisar CORS y ausencia de secretos en frontend, artefactos y logs.
- [ ] Probar login/logout, aceptación de invitación OWNER, clientes, crear/editar/activar/desactivar servicios, guardar/copiar disponibilidad, consultar slots, reservar, confirmar, cancelar, reprogramar, historial y explicación Gemini.
- [ ] Verificar `/health`, `/ready` y `/metrics` según su configuración de acceso. Probar campana, CTA de toasts, solicitud pendiente/resuelta/obsoleta, sincronización de agenda y regreso por breadcrumbs en escritorio y móvil.

**Cierre:** URLs y SHA documentados, recorrido real aprobado con cuentas de prueba y límites observados. Un deploy exitoso no basta para cerrar esta tarea.

### FINAL-06 · Validar correo real y recuperación de la cola

- [ ] Configurar Resend y remitente verificado; comprobar recepción de reserva inmediata, confirmación, cancelación y reprogramación respetando preferencias y acciones públicas vigentes.
- [ ] Validar recordatorios, cambio de anticipaciones, desactivación y reconciliación sin reenviar los procesados. Probar fallo/reintento del proveedor sin perder el turno ni duplicar el envío.
- [ ] Comprobar que Supabase Cron despierta al backend de Render y recupera trabajos vencidos tras la suspensión. Registrar Cron, intentos del procesador y aceptación del proveedor.
- [ ] Revisar correos recibidos en Gmail/Outlook y móvil, con zona horaria, enlaces y acciones. `SENT` acredita aceptación del proveedor; comprobar también entrega y rebotes.

**Cierre:** recorrido real documentado; no basta el proveedor simulado ni la vista previa HTML. [Guía](operations.md#notificaciones-de-turnos).

### FINAL-07 · Cerrar documentación y evidencia académica

- [ ] Actualizar instalación/demo con URLs, SHA, variables requeridas sin valores sensibles, pruebas finales y limitaciones conocidas.
- [ ] Reconciliar requisitos de la consigna con la evidencia y registrar respuestas pendientes en [AI-DECISIONS](../AI-DECISIONS.md#pendientes-con-docentes-a10): despliegue manual, contingencia local y cierre del entorno. Actualizar las fechas históricas para esta entrega.
- [ ] Actualizar [costos](costs.md): saldo/cuotas, presupuesto y alertas si corresponde, ledger real y fecha de apagado de recursos temporales sin afectar la evaluación.
- [ ] Preparar guion con datos sintéticos, cuentas por rol, resultados esperados y contingencia ante caída de proveedores; entregar enlaces y artefactos exigidos por la consigna.

**Cierre:** documentación coherente con el candidato publicado y evidencia revisable. No dar por aceptadas decisiones docentes ni costos actuales basándose en relevamientos de octubre.

## P1 · Robustez y cobertura posterior

- Incorporar a CI una base efímera para integración y un recorrido Playwright contra API/Auth reales; incluir backup/restauración en un job con Docker y PowerShell. Los permisos del destino se verifican antes de entregar mediante FINAL-02.
- Completar el monitoreo de la API y de la cola de correo con métricas persistentes y alertas para fallos y demoras.
- Acordar y documentar cómo ofrecer horarios en fechas con transiciones horarias. Hoy los slots rechazan franjas ambiguas, inexistentes o que atraviesan un cambio de offset.
- Ampliar el historial de cliente, los filtros por riesgo, los reportes de ocupación e inasistencias y la calibración de umbrales. La agenda ya incluye indicadores diarios y un ranking con los turnos analizados durante la sesión.

## P2 · Evolución del producto

Fuera del alcance actual, salvo exigencia explícita de la consigna:

- Registro público, recuperación de contraseña y gestión e invitación de miembros.
- Reserva pública de turnos nuevos. Los enlaces actuales operan sobre una reserva existente.
- Lista de espera y sugerencias para cubrir huecos, WhatsApp, pagos o señas y analítica avanzada.

## Funcionalidades implementadas

Identidad e invitaciones de OWNER, clientes, servicios, disponibilidad semanal, consulta de slots, agenda, gestión de turnos, historial, score heurístico y explicación con Gemini. El centro interno de notificaciones ya está integrado. La rama incorpora enlaces públicos, solicitudes de cambio, correo transaccional asíncrono y recordatorios configurables por anticipación. Configuración y Servicios tienen una composición compacta responsive; la disponibilidad se edita en modal. La campana global y los toasts sincronizan la agenda sin recarga manual. Sus preferencias y validaciones están en [notificaciones](notifications-plan.md).

## Condición de entrega final

Cerrar las siete tareas FINAL con evidencia y registrar cualquier excepción acordada. No declarar el proyecto listo mientras fallen controles obligatorios o falte validar el entorno publicado. Los backlogs históricos se conservan como referencia; este archivo reúne el trabajo vigente.
