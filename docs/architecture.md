# Arquitectura

```text
Navegador ── sesión ──────────────────────────────── Supabase Auth
   │
   ├── agenda y pantallas del negocio ── REST + bearer de Supabase ──┐
   └── /turno/gestionar ───────────────── REST + enlace firmado ─────┤
                                                                    ▼
Supabase Cron ── POST /internal/email-jobs ────────────────────── Express
                                                                    ├── Prisma ── PostgreSQL
                                                                    ├── explicación ── Gemini
                                                                    └── procesador ── Resend
```

Next.js y Material UI presentan las pantallas del negocio. FullCalendar dibuja la agenda en su zona horaria. Express reúne los módulos A (identidad y clientes), B (servicios y horarios) y C (turnos y reservas), con riesgo y notificaciones como capacidades transversales. Las apps comparten tipos y validaciones de `@turnosmart/shared`.

## Identidad y aislamiento

- Supabase Auth valida la sesión con `auth.getUser`. Express resuelve el acceso: un ADMIN global (`platform_admins`) sólo usa el panel de la plataforma y un OWNER activo (`profiles`) opera su negocio. La Data API de Supabase está cerrada para `anon` y `authenticated` (ver [identidad y seguridad](identity-security.md)). El onboarding crea negocio y perfil OWNER en una transacción y devuelve el negocio ganador ante solicitudes concurrentes.
- `Business` es la raíz del tenant. Los repositorios filtran por su ID tomado del perfil. Las relaciones compuestas impiden referencias entre negocios y la API responde 404 para recursos de otro tenant.
- PostgreSQL aplica RLS a las tablas de dominio expuestas a la Data API. La conexión de Prisma puede omitir RLS y depende de los filtros del backend. Las migraciones de notificaciones y acciones públicas revocan acceso directo a enlaces, avisos y cola, y revocan la escritura directa de turnos y eventos. Revisar los permisos restantes de la Data API es parte del [backlog](backlog.md).

## Agenda, reservas y riesgo

Las reglas semanales guardan horas locales `HH:mm`. Los turnos guardan instantes UTC. La consulta de slots calcula comienzos futuros cada 15 minutos desde el inicio de cada franja, según la duración del servicio y la ocupación de la única agenda. Una franja con horas ambiguas o inexistentes, o que cruza una transición de offset, no se ofrece.

Crear o reprogramar un turno bloquea la fila `Business` y vuelve a leer cliente, servicio, disponibilidad, zona horaria y ocupación dentro de la transacción. Las mutaciones de turno y los cambios de configuración relevantes comparten ese bloqueo. Los cambios de disponibilidad o zona se rechazan si dejan turnos vigentes fuera de atención. Turno, evento y trabajos asociados se persisten como parte de la mutación. El score se guarda después de confirmar la transacción de reserva o reprogramación.

El score aplica reglas sobre antecedentes de ausencias, cancelaciones y anticipación, con niveles LOW, MEDIUM y HIGH. Gemini recibe el score, nivel y factores saneados para generar una explicación y recomendaciones bajo demanda. La salida estructurada se valida con Zod. La llamada tiene timeout, un reintento si la respuesta es inválida y un límite por usuario en memoria.

## Notificaciones

El centro de notificaciones registra avisos del negocio y lecturas por perfil. Una campana del layout autenticado comparte esos datos entre pantallas. El frontend consulta cada cinco segundos mientras está visible, actualiza la agenda ante notificaciones nuevas y muestra toasts de cancelaciones y solicitudes. La carga inicial es silenciosa; la reconciliación completa periódica contempla que `createdAt` no refleja necesariamente el orden de commit de eventos concurrentes. La agenda también muestra avisos de proximidad. Los correos transaccionales habilitados y con destinatario válido se encolan junto con el evento y la reserva en la misma transacción PostgreSQL. Tras completar la respuesta HTTP, se solicita su procesamiento asíncrono. Los recordatorios se programan en PostgreSQL según las preferencias guardadas, con claves de deduplicación. El procesador reclama trabajos vencidos y usa el proveedor configurado. Supabase Cron puede invocar ese mismo procesador si el backend se suspendió.

Los enlaces públicos se firman con HMAC y se limitan a una acción, destinatario y versión del horario. El cliente puede confirmar, cancelar según la política vigente o pedir una reprogramación. La reserva original se conserva hasta que el personal aprueba un horario disponible. Los detalles de configuración y validación están en la [guía de operación](operations.md#notificaciones-de-turnos).

## Infraestructura y observabilidad

Docker Compose provee PostgreSQL y Supabase Auth para desarrollo. GitHub Actions valida el monorepo y publica el frontend en Vercel cuando se habilita el flujo correspondiente. Render tiene una configuración para el backend de Dev. Azure App Service tiene Bicep y un artefacto ZIP para un despliegue manual de checkpoint.

Express emite logs JSON y IDs de solicitud, expone `/health` y `/ready`, y publica contadores HTTP en memoria en `/metrics`. La integración con monitoreo externo y la verificación de los servicios publicados figuran en el [backlog](backlog.md).
