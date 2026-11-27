# Operación y demo

## Validación local

Usar Node.js 22 y configurar Supabase según el [README raíz](../README.md). `npm run docker:dev` aplica las migraciones y carga el seed local. Para preparar un entorno manual:

```powershell
npm ci
npm run prisma:generate --workspace=apps/backend
npm run prisma:migrate --workspace=apps/backend
npm run typecheck
npm test
```

El [seed de desarrollo](../apps/backend/prisma/README.md) es opcional y requiere configurar las credenciales de su destino. Para probar transacciones y concurrencia contra PostgreSQL real, definir
`DATABASE_URL` y `DIRECT_URL` apuntando a una base descartable con las migraciones
aplicadas y ejecutar:

```powershell
npm run test:integration
```

## Seguridad de Next.js (P0-05)

Verificado el 25 de noviembre de 2026 con Node **22.23.4** y npm **10.9.9**, usando una copia limpia del árbol de trabajo y el mismo `package-lock.json` que se entrega.

| Dependencia                                         | Anterior | Validada |
| --------------------------------------------------- | -------- | -------- |
| Next.js y eslint-config-next                        | 16.4.3   | 16.4.5   |
| React y React DOM                                   | 19.2.8   | 19.2.8   |
| typescript-eslint                                   | 8.72.1   | 8.73.0   |
| minimatch afectado, transitivo de typescript-eslint | 10.2.6   | 11.0.9   |

Next.js 16.4.5 es el parche mínimo de la [publicación oficial de noviembre](https://nextjs.org/blog/november-2026-security-release). Se comprobaron estos avisos contra la versión instalada:

| CVE                        | GHSA                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| CVE-2026-119790            | [GHSA-mfr8-8qww-v76h](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h)   |
| CVE-2026-119351            | [GHSA-vc7v-qv4w-wrv8](https://github.com/vercel/next.js/security/advisories/GHSA-vc7v-qv4w-wrv8)   |
| CVE-2026-119347            | [GHSA-7qx7-33qx-rqx2](https://github.com/vercel/next.js/security/advisories/GHSA-7qx7-33qx-rqx2)   |
| CVE-2026-119346            | [GHSA-f3mh-rxg3-f5g2](https://github.com/vercel/next.js/security/advisories/GHSA-f3mh-rxg3-f5g2)   |
| CVE-2026-119348            | [GHSA-pc58-hwjq-p385](https://github.com/vercel/next.js/security/advisories/GHSA-pc58-hwjq-p385)   |
| CVE-2026-119349            | [GHSA-rhh4-g77r-r9qj](https://github.com/vercel/next.js/security/advisories/GHSA-rhh4-g77r-r9qj)   |
| CVE-2026-119350            | [GHSA-vvgp-ww4w-46vf](https://github.com/vercel/next.js/security/advisories/GHSA-vvgp-ww4w-46vf)   |
| CVE-2026-118764, minimatch | [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) |

No se identificaron usos de Cache Components, `use cache`, rutas Edge ni optimización de imágenes que activen los escenarios publicados en el frontend actual. Se actualizó igualmente el paquete afectado. La corrección de minimatch llega mediante typescript-eslint, sin overrides ni actualización mayor de las dependencias directas.

Resultados de validación:

- `npm audit` pasó de ocho paquetes reportados a cero; `npm audit --omit=dev`, de uno a cero. Next.js concentraba siete avisos; el otro origen era minimatch.
- `npm ci --include=dev --no-audit --fund=false` y `npm run build:shared`: aprobados. Para comprobar el aislamiento del frontend se usó `PRISMA_SKIP_POSTINSTALL_GENERATE=true` durante la instalación.
- `npm run build --workspace=apps/frontend` y `npm run verify:public-build --workspace=apps/frontend`: aprobados antes de generar Prisma. El standalone tampoco incluye Prisma ni el backend. No se detectaron las claves privadas señuelo en el bundle público.
- El evaluador nativo de seguridad de Next.js identifica 16.4.3 como afectada y no emite recordatorio para 16.4.5. El build nuevo terminó sin `SecurityFatalError`; no se desactivaron controles de seguridad.
- `npm run prisma:generate --workspace=apps/backend`, build del backend, `npm run lint` y `npm run typecheck`: aprobados. Prisma se generó con URLs locales de diagnóstico, sin conectar a una base ni ejecutar migraciones.
- `npm test`: 216 pruebas unitarias y 18 pruebas de instalación/infra aprobadas. `npm run test:config --workspace=apps/frontend`: 52 aprobadas.
- Playwright contra el standalone de producción en Node 22: nueve escenarios aprobados de reserva, navegación, notificaciones y acciones públicas, con respuestas HTTP simuladas. Se corrigió una medición intermitente del test móvil: ambos rectángulos se leen en una sola evaluación, conservando una condición estricta de separación.
- `npm run format:check`: falla por 77 archivos preexistentes fuera de este parche. Los manifiestos, lockfile y ajuste del test cumplen Prettier. Este gate continúa pendiente y no se omitió ni flexibilizó.

CI y Vercel CLI 65.9.0 conservan sus workflows: Node 22 satisface sus engines y la instalación desde la raíz mantiene npm workspaces y el build de shared anterior al frontend. No se ejecutaron workflows remotos ni despliegues; la corrección del checkout no equivale a actualizar entornos publicados. Repetir las auditorías antes de publicar porque pueden aparecer avisos nuevos.

## Backup

### Alcance y requisitos

[backup-db.ps1](../scripts/backup-db.ps1) y [restore-db.ps1](../scripts/restore-db.ps1) son entradas PowerShell **7.4 o posterior** para el motor compartido [database-backup.mjs](../scripts/database-backup.mjs). **Node 22.x es la única versión oficialmente soportada**, de acuerdo con `engines`, `.nvmrc` y CI; el CLI rechaza otras versiones, incluida Node 24. No agregan paquetes npm, proveedores ni servicios pagos.

El backup es un `pg_dump --format=custom --no-tablespaces` de **una base PostgreSQL completa accesible al usuario**. Conserva datos, esquemas, objetos, propietarios, ACL, RLS y `_prisma_migrations`. Se registra un inventario cifrado de roles, membresías, permisos de la base y extensiones. No se exportan contraseñas de roles ni tablespaces. En recuperación se recrean los roles como **NOLOGIN/NOSUPERUSER**, manteniendo herencia, BYPASSRLS y membresías; el administrador interno `postgres` del contenedor no se reemplaza. Las credenciales de aplicación y los privilegios globales que se normalizan requieren un procedimiento separado antes de cualquier cutover.

Para el origen nativo hacen falta `pg_dump` y `psql` de la **misma versión mayor** que el servidor. Se usa exclusivamente `DIRECT_URL`, nunca `DATABASE_URL` como fallback ni archivos `.env` implícitos. La conexión debe ser directa o un **session pooler**: se rechazan el puerto transaccional 6543 y `pgbouncer`. Un host `*.pooler.supabase.com` exige `-ConnectionMode session`. Fuera de loopback se requiere `sslmode=verify-full` y una raíz confiable para libpq (`PGSSLROOTCERT` si corresponde). La etiqueta `SourceEnvironment` es declarada por el operador; no identifica por sí sola un proyecto remoto.

También se admite `-SourceContainer` para leer un PostgreSQL Docker local por su socket Unix, sin contraseña ni puertos publicados. El cliente se ejecuta dentro del contenedor. No se hace ninguna escritura de dominio en el origen. `ExpectedDatabase` y la presencia de la tabla de migraciones se comprueban antes del dump.

### Clave, cifrado e integridad

La clave es un archivo de **32 bytes aleatorios**, fuera del checkout y separado del directorio de backups. Su ACL en Windows permite únicamente al usuario actual; en Unix se exige propietario actual y modo 600. Guardar una copia de recuperación de la clave en un soporte seguro separado y comprobarla periódicamente. Perderla impide recuperar los backups. No guardarla junto al artefacto, sincronizarla con un directorio público ni incluirla en Git.

```powershell
# Crear una sola vez; nunca sobrescribe una clave existente.
$key = Join-Path $env:LOCALAPPDATA 'TurnoSmart/backup-keys/recovery.backup-key'
./scripts/backup-db.ps1 -GenerateKey -KeyFile $key
```

El dump fluye directamente desde stdout de `pg_dump` a **AES-256-GCM**; nunca se escribe un dump en claro en el host. El formato versionado `TSB1` contiene IV aleatorio de 12 bytes, ciphertext y tag de 16 bytes, con AAD distinta para dump y metadata. La metadata también se cifra. Se publican tres archivos con fecha UTC, entorno, prefijo del SHA de Git y un identificador aleatorio:

- `*.dump.enc`: dump autenticado y cifrado.
- `*.meta.enc`: identidad del origen, versión de PostgreSQL, inventario de permisos y SHA-256 del dump en claro, cifrados y autenticados.
- `*.backup.json`: índice publicado **al final**, con fecha, entorno, SHA, indicador `dirty` y SHA-256 de ambos archivos cifrados. Es el archivo que recibe la restauración. Transportar los tres juntos.

Se comprueban salida de procesos, cabecera custom y checksums, se sincronizan los archivos y no se sobrescriben backups anteriores. La publicación exclusiva utiliza enlaces duros: el directorio de salida debe estar en NTFS u otro filesystem compatible; después se pueden copiar los tres archivos cifrados a otro soporte. El SHA identifica el checkout que ejecuta la herramienta; `dirty=true` advierte cambios locales y **no prueba qué release está desplegado**. Coordinar una ventana sin migraciones/DDL ni cambios de roles; `pg_dump` proporciona su propio snapshot consistente de datos, pero el inventario global de roles no forma parte de esa transacción.

Las credenciales nativas van en un `PGPASSFILE` privado temporal dentro del área local del sistema, separado de los archivos cifrados y del directorio de salida. No aparecen en argv ni se reenvían URLs o variables de servicios cloud a los clientes. Los diagnósticos externos se drenan sin registrar SQL, valores o credenciales. Un fallo informa herramienta/código y no un éxito ficticio. La limpieza normal y las interrupciones controladas eliminan el staging propio, sin seguir enlaces ni tocar otros backups.

### Ejecutar un backup

```powershell
$out = Join-Path $env:LOCALAPPDATA 'TurnoSmart/backups'
# Ejemplo Docker local: reemplazar el nombre por el contenedor PostgreSQL real.
$backup = ./scripts/backup-db.ps1 -SourceEnvironment local `
  -ExpectedDatabase turnosmart_local -DatabaseUser turnosmart_local `
  -SourceContainer '<contenedor-postgres-local>' -KeyFile $key `
  -OutputDirectory $out | ConvertFrom-Json
```

Para conexión nativa, cargar la URL sin escribir una contraseña en el historial de la consola. No pegar secretos en argumentos ni redirigirlos a logs:

```powershell
$secret = Read-Host 'DIRECT_URL PostgreSQL (directa o session)' -AsSecureString
$env:DIRECT_URL = [Net.NetworkCredential]::new('', $secret).Password
try {
  $backup = ./scripts/backup-db.ps1 -SourceEnvironment staging `
    -ExpectedDatabase postgres -ConnectionMode session -KeyFile $key `
    -OutputDirectory $out | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'El backup no fue confirmado.' }
} finally { Remove-Item Env:DIRECT_URL -ErrorAction SilentlyContinue }
```

### Recuperación local aislada

No se acepta `TargetDatabaseUrl`, un destino existente ni una opción para omitir las barreras. La restauración exige un daemon Docker local y crea un **contenedor nuevo**, identificado por ID completo, nombre `turnosmart-restore-*` y etiqueta de sesión. Un nombre ocupado falla sin modificarlo. PostgreSQL usa tmpfs, usuario no root, filesystem raíz de sólo lectura, capacidades retiradas, límites de CPU/memoria, sin red ni montajes del host. No hay contraseña de destino: sólo existe el socket interno aislado.

La imagen por defecto es el mismo PostgreSQL 16 Alpine fijado por digest en Docker local; debe estar disponible de antemano (`--pull=never`). `-PostgresImage` permite otro `postgres:<major>-alpine@sha256:<digest>` oficial ya descargado, de la misma versión mayor del dump y con layout de volúmenes compatible. Se rechaza cualquier volumen declarado que no quede cubierto por el tmpfs; no se crean volúmenes anónimos para adaptar imágenes incompatibles. Sólo PostgreSQL 16 fue ensayado en esta validación. El preflight verifica versiones de extensiones disponibles y **aborta con un error concreto** si faltan; no filtra esquemas, ACL ni extensiones para esconder incompatibilidades.

```powershell
$recovery = ./scripts/restore-db.ps1 -BackupFile $backup.backupFile `
  -ExpectedEnvironment local -KeyFile $key `
  -ConfirmRestore RESTORE_TEST_DATABASE | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'La recuperación no fue confirmada.' }
$recovery.verification
```

El índice, sus rutas y checksums, la metadata autenticada y el entorno se verifican antes de crear el destino. La identidad SQL debe ser la base vacía `turnosmart_restore`, usuario `postgres` y versión esperada. El dump se descifra únicamente a tmpfs, se comprueban tag GCM, SHA-256 y `pg_restore --list` **antes de ejecutar SQL**. Luego se usa `pg_restore --single-transaction --exit-on-error`, preservando ACL/propietarios y sin `--clean`. Las migraciones, constraints y RLS se verifican y el dump temporal se elimina antes de devolver éxito. La preparación de roles precede a esa transacción; ante cualquier fallo se elimina el contenedor propio completo, por lo que no queda un destino parcial publicado.

El contenedor exitoso queda disponible para inspección, sin conectarlo a la aplicación ni iniciar workers de correo. Los datos están sólo en memoria: no reiniciarlo antes de terminar la verificación. `-MemoryMb` (1024 por defecto) limita recursos; aproximadamente 60% corresponde a datos y 30% al archivo temporal. Para un backup mayor se debe ensayar y dimensionar explícitamente; el límite no se presenta como capacidad de producción.

```powershell
# Después de inspeccionar: token de propiedad del recurso, no credencial PostgreSQL.
./scripts/restore-db.ps1 -CleanupContainerId $recovery.containerId `
  -CleanupToken $recovery.cleanupToken -ConfirmCleanup REMOVE_LOCAL_RECOVERY
```

La limpieza comprueba nuevamente daemon local, ID, etiqueta, nombre, red y montajes antes de eliminar **sólo** ese recurso. SIGINT/SIGTERM cooperativos ejecutan los `finally` y limpieza; Task Manager/`taskkill /F`, SIGKILL, caída del host o energía pueden impedirlo. En ese caso no asumir éxito: conservar los artefactos cuyo índice e integridad se verifiquen, identificar contenedores con `docker ps -a --no-trunc --filter label=io.turnosmart.recovery-session`, consultar su etiqueta de sesión y usar la limpieza validada. Un staging residual de credenciales tiene ACL privada, pero debe revisarse y eliminarse por su propietario; no existe garantía de borrado físico seguro en SSD, swap o snapshots del sistema.

### Rollback y migraciones incompatibles

- **Frontend:** volver sólo a un artefacto compatible con la API actual y con las variables públicas verificadas. No degradar los parches de seguridad de P0-05. Un rollback de UI no revierte datos ni esquema.
- **Backend:** una versión anterior sólo es utilizable si su Prisma Client y consultas son compatibles con el esquema vigente. La migración histórica `20261112000200_appointment_notification_actions` reemplaza `AppointmentStatus`, elimina `CONFIRMED` de ese enum y traslada el estado a `confirmation_status`. El backend previo que escribe/castea `status='CONFIRMED'` falla sobre el esquema nuevo. **No hacer ese rollback binario directo.**
- **Corrección hacia adelante:** opción preferida si se puede conservar el esquema/datos. Crear una nueva migración y release compatibles, probar sobre una copia y preservar historial. No editar una migración ya aplicada ni marcarla resuelta para esconder un fallo.
- **Rollback de esquema/datos:** un dump anterior es una recuperación de un punto en el tiempo, no un `down` automático. Detener escrituras y workers en el procedimiento de entrega aprobado, preservar el estado actual para investigación, restaurar el backup previo en un destino **nuevo y compatible**, verificar datos/migraciones/ACL/RLS y usar el backend correspondiente a ese esquema. Sólo después planificar el cutover con autorización. Las escrituras posteriores al backup se pierden si no existe una estrategia adicional de reconciliación/PITR.
- **Migración incompatible o fallida:** no improvisar una conversión inversa de `CONFIRMED`. Conservar ambos lados, identificar las migraciones efectivamente aplicadas y elegir entre nueva migración correctiva o recuperación completa previa. Ensayar la opción y el emparejamiento código/esquema antes de actuar en el entorno de entrega. Estos scripts no tienen una vía para restaurar directamente sobre producción.

### Qué no recupera este ensayo

La recuperación de PostgreSQL **no equivale a recuperar Supabase integralmente**. El dump puede incluir tablas SQL de `auth`/`storage` si el usuario tiene acceso, pero no recupera objetos de Storage, JWT/OAuth/SMTP y otros secretos, configuración del proyecto, servicios GoTrue/PostgREST/Realtime/Edge, DNS, jobs externos ni credenciales de roles. Tampoco se ha probado aquí un proyecto Supabase remoto ni su conjunto real de extensiones. Un PostgreSQL Alpine estándar puede carecer de `pg_net`, Vault u otras dependencias: el preflight debe fallar, no afirmar una recuperación completa.

Una recuperación integral requiere un destino Supabase compatible, backups separados de objetos/configuración/secretos, versiones de servicios coordinadas, validación de sesiones/IDs Auth, permisos y cron, y un plan de cutover ensayado. Ver [pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html) y los [límites del backup de Supabase](https://supabase.com/docs/guides/platform/backups).

Pruebas reproducibles, sin destinos remotos ni bases existentes:

```powershell
npm run test:backup             # Incluido en npm test; Node 22 + Git + pwsh 7.4+ en PATH.
npm run test:backup:integration # Además Docker local; sólo recursos sintéticos recién creados.
```

La suite de backup vuelve a incluir las pruebas Node, los wrappers y los dobles `.ps1` en un único comando. PowerShell 7.4+ es un prerrequisito de `npm test` en Windows, Linux y macOS. No hay un comando separado ni una matriz de CI específica de wrappers.

La expresión de endpoints locales admite `npipe:////./pipe/docker_engine`, `npipe:////./pipe/dockerDesktopLinuxEngine` y sockets absolutos `unix:///…`. Rechaza TCP (también loopback), SSH y named pipes de servidores remotos. Los tests comprueban tanto la selección por contexto como `DOCKER_HOST` y su precedencia; no se ha ampliado la lista de destinos permitidos.

El ensayo aplica las nueve migraciones SQL originales a una base nueva y genera un historial sintético `_prisma_migrations` con sus checksums. Compara registros/hashes, propietarios, concesiones efectivas, RLS, migraciones y referencias después de recuperar. Esto acredita recuperación PostgreSQL del fixture; no una recuperación de Supabase Auth ni una ejecución de Prisma Migrate contra producción. Los tiempos observados se registran en la salida del ensayo y dependen del tamaño real de datos/infraestructura; no son un SLA.

## FINAL-05C: barreras antes del primer merge y de la publicacion

El primer merge incorpora codigo, no autoriza una publicacion. Conservar dev
como default branch y un proyecto Vercel. Antes del merge, comprobar manualmente
que Render Production tiene Auto-Deploy Off y que el publicador manual Production
esta bloqueado hasta autorizar FINAL-05D. No apagar el publicador de Preview ni
el Auto-Deploy de Render Dev. Vercel declara Git deployment deshabilitado; verificar
que el proyecto real usa esa configuracion y que no existen hooks externos de
Production. Estos controles de dashboard no se modifican desde este repositorio.

Preparar ANTES de publicar los cambios las cuatro EXPECTED_* de GitHub, las dos
EXPECTED_*_SUPABASE de cada backend y VERCEL_PRODUCTION_BRANCH=main como variable
de repositorio. Los settings de Preview/Production y los secrets se resuelven en
sus environments respectivos; los IDs del unico proyecto Vercel son los mismos.
Sin las expectativas correctas, los nuevos controles fallan cerrados, incluido Dev.
En Render usar Save only para preparar las variables sin iniciar una publicacion;
no sincronizar el Blueprint ni elegir Save and deploy durante este cierre.

El runtime remoto y la configuracion Prisma para comandos migrate reutilizan el
parser de proyecto del seed. Se exige correspondencia de SUPABASE_URL, DATABASE_URL
y DIRECT_URL si existe; migraciones remotas requieren DIRECT_URL directa/session,
proyectos Dev/Production distintos, TLS y destino seleccionado explicitamente o
derivado de la rama Render. No se cambio la allowlist ni la prohibicion del seed
en Production. No ejecutar migraciones con otros comandos que omitan la configuracion
Prisma del workspace. Las claves publishable opacas no pueden atribuirse offline a
un proyecto; su validez se comprueba por Supabase Auth al usar el servicio.

La promocion frontend exige health del backend del mismo SHA y readiness. Readiness
prueba conectividad, no certifica por si sola todas las migraciones o compatibilidad
funcional: validar el esquema y el recorrido real en la ventana de FINAL-05D.
No usar console para simular correo en una base cloud ni activar el proveedor sin
revisar pendientes. El rollback mantiene las restricciones de esquema documentadas
arriba. La habilitacion del Auto-Deploy Production posterior al bootstrap requiere
coordinar primero esquema y backend; no puede inferirse de un merge ni del CI verde.

## Recorrido de demo

1. Iniciar sesión como ADMIN, crear el negocio e invitar al OWNER; aceptar la invitación desde `/onboarding`.
2. Crear un servicio y una regla de disponibilidad.
3. Crear un cliente.
4. Reservar un turno futuro.
5. Confirmarlo, reprogramarlo o cancelarlo.
6. Consultar el historial de eventos.
7. Consultar el score y solicitar su explicación con Gemini si se configuró `GEMINI_API_KEY`.
8. Revisar `/health`, `/ready` y `/metrics`.

No se deben incluir tokens, notas privadas ni datos personales en capturas o logs.

## Notificaciones de turnos

La API guarda el turno y su evento en la misma transacción PostgreSQL. También encola el correo de reserva cuando esa preferencia está habilitada y el cliente tiene un email válido. Con un proveedor activo, después del commit y de responder a la petición, solicita el procesamiento asíncrono inmediato. Las solicitudes concurrentes comparten un procesador local y cada trabajo conserva su clave de idempotencia y su lease en la base. Un fallo del proveedor conserva el turno y programa el reintento.

Con `EMAIL_PROVIDER=disabled` (valor por defecto) los trabajos quedan en cola. Con un proveedor activo se mantienen el polling cada cinco segundos y Supabase Cron como recuperación. Los recordatorios se calculan restando horas reales del inicio UTC. El email y la interfaz muestran el horario en la zona del negocio.

En **Configuración**, solo OWNER puede guardar las preferencias de correo y de acciones públicas. Los nuevos negocios reciben correo de reserva activado y recordatorios de 48 y 24 horas. Se permiten hasta tres anticipaciones distintas entre 2, 6, 12, 24, 48 y 72 horas. Desactivar recordatorios cancela los trabajos pendientes disponibles. Cambiar anticipaciones reconcilia las reservas futuras, conservando los envíos ya procesados. Un trabajo que el proveedor ya está procesando puede terminar su entrega.

La confirmación, cancelación y solicitud de reprogramación por enlace tienen controles independientes. Cancelar y solicitar un cambio admiten un plazo mínimo. La configuración vigente se vuelve a comprobar al emitir, consultar y ejecutar enlaces, incluidos los emitidos antes del cambio de preferencias. El turno original sigue reservado hasta la aprobación del negocio.

### Agenda, campana y vista previa

La campana está fija en todas las pantallas privadas del personal. El frontend consulta las notificaciones cada cinco segundos con la pestaña visible y al recuperar foco o visibilidad. Los avisos nuevos actualizan el feed diario y el rango visible de la agenda. Cancelaciones y solicitudes de reprogramación muestran un toast con fecha y hora del negocio. La primera carga no reproduce avisos históricos y mostrar el toast no marca la notificación como leída.

La reconciliación completa se realiza cada minuto o al detectar cambios para recuperar eventos publicados fuera de orden. La agenda también actualiza disponibilidad y datos del día cada minuto; ese refresco invalida el calendario visible. La sincronización interna funciona independientemente de `EMAIL_PROVIDER` y de las preferencias de envío de correo.

En Configuración, la vista previa usa la misma plantilla HTML que Resend con datos y enlaces de ejemplo. Conserva encabezado, selector y Cerrar visibles y utiliza un único scroll dentro del correo. No envía mensajes ni crea enlaces públicos reales. Los correos ordenan las acciones habilitadas como confirmar (verde), solicitar reprogramación (borde azul) y cancelar (borde rojo), en una columna.

### Configuración manual

1. Aplicar las migraciones Prisma al entorno elegido. En local, usar una base descartable y `EMAIL_PROVIDER=console` para simular envíos. El modo de consola registra los trabajos como enviados.
2. Para envíos reales, verificar el dominio remitente en Resend, desactivar el seguimiento de clics del dominio y configurar `EMAIL_PROVIDER=resend`, `EMAIL_FROM` y `RESEND_API_KEY` en el backend.
3. Generar `APPOINTMENT_ACTION_SECRET` con 32 bytes aleatorios en hexadecimal. Configurar `APPOINTMENT_ACTIONS_URL` con la URL HTTPS del frontend terminada en `/turno/gestionar` e incluir el origen del frontend en `CORS_ORIGIN`. Con Resend y `NODE_ENV=development` o `test`, también se admite HTTP en `localhost`, `127.0.0.1` y `[::1]`, usando el puerto real del frontend. Por ejemplo, `http://localhost:3001/turno/gestionar`. Abrir esos enlaces en la misma computadora. En producción Resend requiere HTTPS. Tanto `console` como `resend` requieren `EMAIL_FROM`. Cambiar la clave invalida los enlaces ya emitidos.
4. Para que el procesador se ejecute con Render inactivo, habilitar `pg_cron` y `pg_net` en Supabase. Configurar `EMAIL_CRON_SECRET` con otra clave aleatoria de 32 bytes en hexadecimal y guardar el mismo valor en Vault con el nombre `appointment_email_cron_secret`. Guardar también el origen HTTPS del backend en `appointment_email_backend_url`. Ejecutar el [script de Cron](../infra/supabase/appointment-email-cron.sql) después de las migraciones. El job revisa cada cinco minutos y llama a `POST /internal/email-jobs` cuando encuentra trabajos vencidos.
5. Habilitar los tipos de aviso en **Configuración → Notificaciones** y hacer una reserva con un destinatario de prueba para verificar la entrega del entorno.

### Validación en el entorno publicado

- Antes de publicar el backend, aplicar las seis migraciones nuevas en su orden mediante `npm run prisma:migrate --workspace=apps/backend`, incluidas `20261125000100_configurable_reminder_kind` y después `20261125000200_notification_preferences`, y verificar que un turno confirmado de la versión anterior conserva su horario, confirmación e historial. La actualización copia las preferencias anteriores de recordatorios y confirmación. Los valores predeterminados nuevos solo se aplican a negocios nuevos.
- Reservar con un destinatario de prueba. Abrir el enlace de alta, confirmar asistencia y revisar el estado, el historial y el correo de confirmación.
- Solicitar un cambio con un slot propuesto. Comprobar que la agenda conserva el turno original hasta la aprobación, que el correo muestra el nuevo horario y que los enlaces anteriores dejan de servir. Repetir con un rechazo y comprobar que se mantiene la reserva.
- Con la agenda del personal abierta, cancelar desde el enlace del cliente y enviar una solicitud de reprogramación de otro turno. Comprobar actualización automática, contador y toast sin recargar. Verificar que no se repite el toast en las consultas siguientes, que el aviso sigue sin leer y que la solicitud conserva su horario original. Repetir al volver a una pestaña que estaba oculta.
- Probar cancelaciones dentro y fuera del plazo. Verificar que una cancelación exitosa libera el horario.
- Comprobar las anticipaciones configuradas y realizar una prueba con un trabajo vencido y el backend suspendido. Cotejar el cron, el intento del procesador y la aceptación del proveedor. Cambiar las anticipaciones y desactivarlas para comprobar la reconciliación de pendientes, conservando los trabajos enviados.

### Diagnóstico y límites

- Si no se creó un trabajo de correo, comprobar que el aviso correspondiente esté habilitado y que el cliente tenga un email válido. Con el proveedor deshabilitado, un trabajo ya encolado permanece pendiente.
- `reminders` conserva el estado, número de intentos, último error y referencia del proveedor. `SENT` indica aceptación por el proveedor. Revisar entrega y rebotes en Resend. Las filas históricas con `email_kind` nulo quedan fuera del procesador.
- La deduplicación usa el evento para emails transaccionales y turno, versión y anticipación para recordatorios. El procesador reclama cada trabajo con una reserva temporal y reintenta con la misma clave. Los casos inciertos que agotan la ventana de reintentos quedan para revisión.
- Render puede demorar el envío al arrancar en frío y una pausa de Supabase interrumpe el cron. Si el proveedor ya recibió una solicitud de envío antes de una cancelación concurrente, el correo puede llegar con un enlace invalidado. Las cuotas del proveedor también pueden retrasar entregas.
- El token viaja en el fragmento y se retira de la barra de dirección al cargar la página. Las consultas de vista previa y disponibilidad carecen de efectos sobre el turno. La acción exige un POST explícito y vuelve a comprobar la validez del enlace.

### Validación local del módulo

- Con una base descartable migrada, ejecutar `npm run test:integration --workspace=apps/backend`. Las pruebas de notificaciones usan un proveedor simulado y un reloj controlado para ejecutar los recordatorios predeterminados de 48 y 24 horas y las anticipaciones configurables, además de su reconciliación y cancelación.
- Con el frontend local activo, configurar `E2E_BASE_URL` y ejecutar `npm run test:e2e --workspace=apps/frontend -- public-appointment-actions calendar-events new-appointment notification-settings services --workers=1`. Los escenarios de navegador simulan las respuestas HTTP. Las pruebas de integración verifican las mutaciones y la cola contra PostgreSQL.

Los [resultados locales del 25 de noviembre de 2026](../tests/README.md#validación-local-del-25-de-noviembre-de-2026) incluyen instalación limpia de las nueve migraciones y suites con proveedor simulado. La recepción real, Gmail/Outlook y el despertar del backend mediante Cron se comprueban en el entorno de entrega.
