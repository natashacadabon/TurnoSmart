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

## Backup

El script [backup-db.ps1](../scripts/backup-db.ps1) usa `pg_dump` en formato custom.
Debe ejecutarse con `DATABASE_URL` configurada y guardarse fuera del repositorio.
Los backups deben cifrarse y probarse mediante una restauración periódica en una
base descartable.

Para restaurar un backup, usar siempre una base de prueba independiente:

```powershell
./scripts/restore-db.ps1 `
  -BackupFile ./backups/turnosmart-YYYYMMDD-HHmmss.dump `
  -TargetDatabaseUrl $env:TEST_DATABASE_URL `
  -ConfirmRestore RESTORE_TEST_DATABASE
```

El parámetro `-ConfirmRestore RESTORE_TEST_DATABASE` evita ejecutar por accidente
una restauración destructiva sobre una base productiva.

## Recorrido de demo

1. Iniciar sesión y completar onboarding.
2. Crear un servicio y una regla de disponibilidad.
3. Crear un cliente.
4. Reservar un turno futuro.
5. Confirmarlo, reprogramarlo o cancelarlo.
6. Consultar el historial de eventos.
7. Consultar el score y solicitar su explicación con Gemini si se configuró `GEMINI_API_KEY`.
8. Revisar `/health`, `/ready` y `/metrics`.

No se deben incluir tokens, notas privadas ni datos personales en capturas o logs.

## Notificaciones de turnos

La API guarda el turno, su evento y el correo de reserva dentro de la misma transacción PostgreSQL. Después del commit y de responder a la petición, solicita el procesamiento asíncrono inmediato. Las solicitudes concurrentes comparten un procesador local y cada trabajo conserva su clave de idempotencia y su lease en la base. Un fallo del proveedor conserva el turno y programa el reintento.

Con `EMAIL_PROVIDER=disabled` (valor por defecto) los trabajos quedan en cola. Con un proveedor activo se mantienen el polling cada cinco segundos y Supabase Cron como recuperación. Los recordatorios se calculan restando horas reales del inicio UTC. El email y la interfaz muestran el horario en la zona del negocio.

En **Configuración**, OWNER y ADMIN pueden guardar las preferencias de correo y de acciones públicas. Los nuevos negocios reciben correo de reserva activado y recordatorios de 48 y 24 horas. Se permiten hasta tres anticipaciones distintas entre 2, 6, 12, 24, 48 y 72 horas. Desactivar recordatorios cancela los trabajos pendientes disponibles. Cambiar anticipaciones reconcilia las reservas futuras, conservando los envíos ya procesados. Un trabajo que el proveedor ya está procesando puede terminar su entrega.

La confirmación, cancelación y solicitud de reprogramación por enlace tienen controles independientes. Cancelar y solicitar un cambio admiten un plazo mínimo. La configuración vigente se vuelve a comprobar al emitir, consultar y ejecutar enlaces, incluidos los emitidos antes del cambio de preferencias. El turno original sigue reservado hasta la aprobación del negocio.

### Configuración manual

1. Aplicar las migraciones Prisma al entorno elegido. En local, usar una base descartable y `EMAIL_PROVIDER=console` para simular envíos. El modo de consola registra los trabajos como enviados.
2. Para envíos reales, verificar el dominio remitente en Resend, desactivar el seguimiento de clics del dominio y configurar `EMAIL_PROVIDER=resend`, `EMAIL_FROM` y `RESEND_API_KEY` en el backend.
3. Generar `APPOINTMENT_ACTION_SECRET` con 32 bytes aleatorios en hexadecimal. Configurar `APPOINTMENT_ACTIONS_URL` con la URL HTTPS del frontend terminada en `/turno/gestionar` e incluir el origen del frontend en `CORS_ORIGIN`. Con Resend y `NODE_ENV=development` o `test`, también se admite HTTP en `localhost`, `127.0.0.1` y `[::1]`, usando el puerto real del frontend. Por ejemplo, `http://localhost:3001/turno/gestionar`. Abrir esos enlaces en la misma computadora. En producción Resend requiere HTTPS. Tanto `console` como `resend` requieren `EMAIL_FROM`. Cambiar la clave invalida los enlaces ya emitidos.
4. Para que el procesador se ejecute con Render inactivo, habilitar `pg_cron` y `pg_net` en Supabase. Configurar `EMAIL_CRON_SECRET` con otra clave aleatoria de 32 bytes en hexadecimal y guardar el mismo valor en Vault con el nombre `appointment_email_cron_secret`. Guardar también el origen HTTPS del backend en `appointment_email_backend_url`. Ejecutar el [script de Cron](../infra/supabase/appointment-email-cron.sql) después de las migraciones. El job revisa cada cinco minutos y llama a `POST /internal/email-jobs` cuando encuentra trabajos vencidos.
5. Habilitar los tipos de aviso en **Configuración → Notificaciones** y hacer una reserva con un destinatario de prueba para verificar la entrega del entorno.

### Validación en el entorno publicado

- Antes de publicar el backend, aplicar las migraciones, incluida `20261125000100_configurable_reminder_kind` y después `20261125000200_notification_preferences`, y verificar que un turno confirmado de la versión anterior conserva su horario, confirmación e historial. La actualización copia las preferencias anteriores de recordatorios y confirmación. Los valores predeterminados nuevos solo se aplican a negocios nuevos.
- Reservar con un destinatario de prueba. Abrir el enlace de alta, confirmar asistencia y revisar el estado, el historial y el correo de confirmación.
- Solicitar un cambio con un slot propuesto. Comprobar que la agenda conserva el turno original hasta la aprobación, que el correo muestra el nuevo horario y que los enlaces anteriores dejan de servir. Repetir con un rechazo y comprobar que se mantiene la reserva.
- Probar cancelaciones dentro y fuera del plazo. Verificar que una cancelación exitosa libera el horario.
- Comprobar las anticipaciones configuradas y realizar una prueba con un trabajo vencido y el backend suspendido. Cotejar el cron, el intento del procesador y la aceptación del proveedor. Cambiar las anticipaciones y desactivarlas para comprobar la reconciliación de pendientes, conservando los trabajos enviados.

### Diagnóstico y límites

- `reminders` conserva el estado, número de intentos, último error y referencia del proveedor. `SENT` indica aceptación por el proveedor. Revisar entrega y rebotes en Resend. Las filas históricas con `email_kind` nulo quedan fuera del procesador.
- La deduplicación usa el evento para emails transaccionales y turno, versión y anticipación para recordatorios. El procesador reclama cada trabajo con una reserva temporal y reintenta con la misma clave. Los casos inciertos que agotan la ventana de reintentos quedan para revisión.
- Render puede demorar el envío al arrancar en frío y una pausa de Supabase interrumpe el cron. Si el proveedor ya recibió una solicitud de envío antes de una cancelación concurrente, el correo puede llegar con un enlace invalidado. Las cuotas del proveedor también pueden retrasar entregas.
- El token viaja en el fragmento y se retira de la barra de dirección al cargar la página. Las consultas de vista previa y disponibilidad carecen de efectos sobre el turno. La acción exige un POST explícito y vuelve a comprobar la validez del enlace.

### Validación local del módulo

- Con una base descartable migrada, ejecutar `npm run test:integration --workspace=apps/backend`. Las pruebas de notificaciones usan un proveedor simulado y un reloj controlado para ejecutar los envíos de 48 y 24 horas.
- Con el frontend local activo, configurar `E2E_BASE_URL` y ejecutar `npm run test:e2e --workspace=apps/frontend -- public-appointment-actions calendar-events new-appointment --workers=1`. Los escenarios de navegador simulan las respuestas HTTP. Las pruebas de integración verifican las mutaciones y la cola contra PostgreSQL.
