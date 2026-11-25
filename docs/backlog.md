# Backlog de TurnoSmart

Relevamiento del 16 de noviembre de 2026 sobre el árbol de trabajo de `feat/confirma-turnos`, incluidos los cambios locales de notificaciones. Las prioridades siguientes ordenan el trabajo pendiente para la entrega.

## P0 · Validar el recorrido de entrega

- Aplicar las migraciones en una base descartable y ejecutar las suites de integración de reservas, concurrencia, aislamiento y notificaciones. Probar la actualización desde una base anterior que tenga turnos confirmados y cotejar su estado, historial y ocupación después de migrar.
- Configurar el remitente y el proveedor en el entorno de demo, activar preferencias para un negocio de prueba y ejecutar la demo con el frontend publicado. Comprobar entrega por Resend, recordatorios de 48 h y 24 h, confirmación, cancelación según política y solicitud de cambio con aprobación o rechazo.
- Validar que Supabase Cron despierte al backend de Render y que el procesador retome la cola. Verificar CORS, vigencia de enlaces al mover un turno y diagnóstico de fallos de envío. [Guía de operación](operations.md#notificaciones-de-turnos)
- Comprobar el entorno publicado con login, agenda, reserva, historial, Gemini, `/health`, `/ready` y `/metrics`. Confirmar el destino de entrega y usar el [procedimiento de Azure](../infra/azure/README.md) si el checkpoint requiere ese backend.

## P1 · Robustez y cobertura

- Incorporar a CI una base efímera para las pruebas de integración y un recorrido Playwright de turnos y acciones públicas contra API y Auth reales.
- Revisar y restringir permisos directos de las tablas de dominio en Supabase, en particular clientes, servicios, disponibilidad y scores. Agregar pruebas con roles reales de PostgreSQL o Data API para que el acceso directo respete las operaciones autorizadas.
- Completar el monitoreo de la API y de la cola de correo con métricas persistentes y alertas para fallos y demoras.
- Acordar y documentar cómo ofrecer horarios en fechas con transiciones horarias. Hoy los slots rechazan franjas ambiguas, inexistentes o que atraviesan un cambio de offset.
- Ampliar el historial de cliente, los filtros por riesgo, los reportes de ocupación e inasistencias y la calibración de umbrales. La agenda ya incluye indicadores diarios y un ranking con los turnos analizados durante la sesión.

## P2 · Evolución del producto

- Registro público, recuperación de contraseña y gestión e invitación de miembros.
- Reserva pública de turnos nuevos. Los enlaces actuales operan sobre una reserva existente.
- Lista de espera y sugerencias para cubrir huecos, WhatsApp, pagos o señas y analítica avanzada.

## Funcionalidades implementadas

Identidad y onboarding, clientes, servicios, disponibilidad semanal, consulta de slots, agenda, gestión de turnos, historial, score heurístico y explicación con Gemini. El centro interno de notificaciones ya está integrado. Los cambios locales incorporan enlaces públicos, solicitudes de cambio, correo transaccional y recordatorios configurables por anticipación. Sus preferencias y validaciones están en [notificaciones](notifications-plan.md).
