# Notificaciones de turnos

## Alcance implementado

- **Personal.** La agenda muestra avisos de turnos próximos y el centro interno guarda avisos, incluidas solicitudes de cambio, con lecturas por perfil. La campana permanece fija en todas las pantallas privadas. La consulta cada cinco segundos mientras la pestaña está visible actualiza la agenda y muestra toasts nuevos, con reconciliación completa cada minuto o ante cambios para eventos tardíos. La carga inicial es silenciosa y los avisos repetidos se deduplican por ID; los toasts conservan la notificación sin leer.
- **Estado.** La confirmación se guarda aparte del estado operativo. Reprogramar conserva la confirmación histórica y, si cambia el horario, incrementa la versión para invalidar los enlaces anteriores. La API conserva la proyección `status: CONFIRMED` para un turno activo confirmado.
- **Cliente.** En `/turno/gestionar`, un enlace firmado permite confirmar, cancelar según la política del negocio o solicitar un cambio. El pedido puede incluir un horario propuesto y un comentario. La consulta del enlace y de slots es de solo lectura. La ejecución requiere confirmación explícita.
- **Solicitudes.** El negocio ve el pedido en el detalle y puede aprobarlo con un slot vigente o descartarlo. El turno conserva el horario original mientras se revisa el cambio. La decisión queda en el historial.
- **Correo.** Las preferencias de cada negocio controlan avisos de alta y confirmación, cancelación, resultado de un pedido de cambio o reprogramación, y hasta tres recordatorios con anticipaciones distintas de 2, 6, 12, 24, 48 o 72 horas. Los nuevos negocios comienzan con recordatorios de 48 y 24 horas. Los plazos se calculan restando horas al inicio UTC. Al cambiar las preferencias de recordatorios se actualiza la programación de las reservas vigentes.
- **Ejecución.** PostgreSQL conserva la cola, la deduplicación y los intentos. El backend solicita el procesamiento asíncrono después del commit sin bloquear la respuesta. El polling y Supabase Cron recuperan trabajos pendientes y procesan recordatorios programados. Los modos son `disabled`, `console` para pruebas locales y `resend` para entrega real.

## Presentación de correos y vista previa

Todas las clases de correo usan `renderAppointmentEmail`: reserva, confirmación, cancelación, reprogramación, rechazo y recordatorios de cualquier anticipación admitida. Los datos se agrupan en un bloque gris claro y la zona se muestra como ciudad y offset del turno, por ejemplo Buenos Aires (UTC-03:00). El footer identifica a TurnoSmart.

Los enlaces recibidos por la plantilla se muestran verticalmente, con tamaño uniforme: confirmar en verde, solicitar reprogramación con borde azul y cancelar con borde rojo, en ese orden. Solo se renderizan los enlaces suministrados por el backend según la acción y sus preferencias. El correo usa tablas, estilos inline y fuentes del sistema; la comprobación en clientes reales sigue siendo parte de la validación del entorno.

La vista previa de Configuración consume el mismo render que Resend, con datos y enlaces de demostración. No emite tokens ni envía correos. El modal conserva título, selector y Cerrar accesibles y desplaza únicamente el documento del correo dentro de un iframe con sandbox.

## Validación local y pendiente de publicación

La [guía de pruebas](../tests/README.md#validación-local-del-25-de-noviembre-de-2026) registra las suites locales aprobadas y su alcance. En el entorno elegido, aplicar las migraciones y probar el recorrido de punta a punta, con el dominio de Resend, secretos de enlace y cron, CORS y frontend publicado. Verificar recepción, las anticipaciones configuradas y los enlaces antes y después de un cambio de horario. Las suites locales prueban la cola con un proveedor simulado y las pantallas con respuestas interceptadas.

Ver [configuración y diagnóstico](operations.md#notificaciones-de-turnos) y [contratos de preferencias y acciones](contracts.md#preferencias-y-acciones-del-cliente).
