# Identidad, seguridad, IA y observabilidad

Bloques FINAL-10, FINAL-02, FINAL-05B y FINAL-08 (Yae). Describe el comportamiento del código en la rama `feat/final-yae-identidad-seguridad-ia`. La aceptación en un entorno publicado requiere la evidencia indicada al final.

## Modelo de roles

El modelo es el de Sofi (FINAL-11, PRs #36 y #46). Los roles viven en `profiles` y no comparten permisos.

| Rol   | En `profiles`                      | Alcance                                                                                                                                           |
| ----- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADMIN | `role = ADMIN`, `business_id` NULL | Administrador global: alta y estado de negocios, invitación y activación de propietarios. No opera clientes, servicios, agenda, turnos ni riesgo. |
| OWNER | `role = OWNER`, `business_id` fijo | Operación diaria de su negocio. No crea otros OWNER ni accede al panel de la plataforma.                                                          |

- `20261126000100_global_platform_admin` hace `business_id` opcional y desliga del negocio a los ADMIN existentes.
- `20261126000200_platform_roles_and_owner_invitations` deja el enum en OWNER/ADMIN (los STAFF pasan a OWNER), exige `(ADMIN ⇔ business_id NULL)`, agrega `profiles.active`, `businesses.active` y la tabla `owner_invitations`.
- `20261127000100_unique_platform_admin_email` (Yae) impide dos ADMIN globales con el mismo email; el índice de negocio y email no cubre `business_id` NULL.
- Cuentas demo: `admin@turnosmart.test` es el ADMIN global y `owner@turnosmart.test` el OWNER del negocio 1; ambas usan la contraseña local del seed. `owner2@turnosmart.test` es OWNER del negocio 2.

### Matriz de permisos

Fuente única: `PERMISSIONS` en `packages/shared/src/identity.ts`. Todos los permisos operativos son de OWNER; el panel de la plataforma usa `requirePlatformAdmin`.

### Resolución en la API

| Middleware             | Acepta       | Rechaza                                                                            |
| ---------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `authenticate`         | Token válido | 401 `UNAUTHENTICATED` / `TOKEN_INVALID`                                            |
| `requireProfile`       | OWNER activo | 403 `FORBIDDEN` (ADMIN global), 403 `PROFILE_REQUIRED` (sin negocio o desactivado) |
| `requirePlatformAdmin` | ADMIN global | 403 `FORBIDDEN`                                                                    |

`GET /api/me` informa `platformAdmin` y `accountDisabled`; `onboarded` es `true` sólo para un OWNER activo. El negocio siempre sale de `profiles`; `role` o `businessId` enviados en el body se ignoran.

## Cuenta, invitación y recuperación (FINAL-10)

No hay alta pública de negocios: `POST /api/onboarding` responde 403. Un OWNER llega a su negocio así:

1. El ADMIN crea el negocio e invita al OWNER desde `/admin`; recibe un token y se lo pasa al invitado.
2. El invitado crea su cuenta en `/register` **con el mismo email** de la invitación y la verifica con el enlace del correo.
3. Al abrir el enlace llega a `/onboarding`, pega el token y queda como OWNER (`POST /api/admin/owner-invitations/accept`).

| Ruta               | Uso                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `/login`           | Ingreso. ADMIN → `/admin`; sin negocio o desactivado → `/onboarding`; OWNER activo → `/customers`.          |
| `/register`        | Cuenta nueva (≥ 10 caracteres, letras y números) con correo de verificación a `/auth/callback?flow=verify`. |
| `/onboarding`      | Aceptación del token de invitación, o aviso de cuenta desactivada.                                          |
| `/forgot-password` | Pide el correo de recuperación. Siempre muestra el mismo mensaje para no revelar si la cuenta existe.       |
| `/auth/callback`   | Destino de los enlaces de correo. Lee `?flow=` y errores de Supabase (`otp_expired`, `access_denied`).      |
| `/reset-password`  | Nueva contraseña para la sesión abierta por el enlace de recuperación.                                      |
| `/admin`           | Panel del ADMIN global (FINAL-11).                                                                          |

Enlace vencido o ya usado: `/auth/callback` muestra "El enlace venció" o "no es válido" y ofrece pedir otro. Sin sesión válida, `/reset-password` no permite cambiar la contraseña.

### Configuración de Auth (Nati)

En cada proyecto de Supabase (Dev y Production):

- Site URL: el origen HTTPS del frontend de ese entorno.
- Redirect URLs: `<origen>/auth/callback` (y el patrón de Preview de Vercel en Dev).
- Email signups habilitados con confirmación de correo obligatoria (el invitado crea su cuenta); vencimiento OTP de 3600 s; contraseña mínima de 10.
- SMTP propio (Resend) para que invitaciones y recuperación no dependan del límite del SMTP de prueba de Supabase.

En local, `npm run docker:dev` levanta Mailpit: los correos de Auth se ven en `http://localhost:54327` y nunca salen de la máquina.

### Plantillas de correo de Auth

Los correos de verificación, recuperación, invitación y cambio de correo usan el mismo diseño que los correos de turnos (barra azul, marca TurnoSmart y botón principal), en español.

- Fuente: `infra/supabase/email-templates/build.mjs`. Después de editarla, regenerar con `node infra/supabase/email-templates/build.mjs`.
- **Local:** `docker:dev` ya las usa; el gateway las sirve en `/email-templates/` y GoTrue las descarga al enviar, con los asuntos en español.
- **Supabase en la nube (Dev y Production):** en _Authentication → Emails → Templates_, pegar el HTML de cada archivo y el asunto correspondiente:

| Plantilla en Supabase | Archivo             | Asunto                                              |
| --------------------- | ------------------- | --------------------------------------------------- |
| Confirm signup        | `confirmation.html` | Confirmá tu correo en TurnoSmart                    |
| Reset password        | `recovery.html`     | Restablecé tu contraseña de TurnoSmart              |
| Invite user           | `invite.html`       | Te invitaron a administrar un negocio en TurnoSmart |
| Change email address  | `email_change.html` | Confirmá tu nuevo correo en TurnoSmart              |

Los correos de turnos (reserva, confirmación, recordatorios) no cambian: los genera el backend con `packages/shared/src/email-templates.ts`.

## Data API y RLS (FINAL-02)

El frontend usa Supabase sólo para Auth; los datos pasan por Express, que conecta con el rol dueño de las tablas. Nati cerró las 9 tablas originales y `_prisma_migrations` (`20260922000300/400`, incluidos los permisos por columna). La migración `20261126000300_close_data_api_access` (Yae) lo extiende a todo `public`:

- Revoca todos los privilegios de `anon`, `authenticated` y `PUBLIC` sobre tablas (también por columna), secuencias y funciones, y los privilegios por defecto para objetos futuros. Así quedan cerradas también las tablas nuevas, como `notifications` y `owner_invitations`.
- Habilita RLS en todas las tablas como segunda barrera.
- Elimina las políticas "business members ..." que suponían acceso directo por PostgREST.

`test/integration/data-api-access.test.ts` verifica que no queda ningún privilegio, que RLS está activo en todas las tablas, que una tabla nueva nace cerrada y que un JWT de OWNER (como `anon` o `authenticated`) no lee ni escribe. El aislamiento entre dos negocios por la API se prueba en `tenant-isolation.test.ts`.

## Gemini (FINAL-05B)

| Control             | Implementación                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Factores permitidos | `ALLOWED_FACTORS`: sólo los 6 códigos del calculador (incluida la confirmación del cliente), con etiqueta y significado fijos. Sin nombres, notas, emails, teléfonos ni IDs. |
| Valores             | Sólo números o booleanos; score 0–100 e impacto acotados.                                                                                                                    |
| Instrucciones       | No incluir datos personales ni enlaces; ignorar instrucciones dentro de los datos; no cancelar turnos.                                                                       |
| Salida              | JSON con schema; se descarta si contiene email, teléfono, URL o cancelación automática. Un reintento.                                                                        |
| Límites             | Por usuario (`AI_RATE_LIMIT_PER_USER`) y global por instancia (`AI_GLOBAL_LIMIT_PER_WINDOW`).                                                                                |
| Timeout             | `GEMINI_TIMEOUT_MS` (8 s) → 504 `AI_TIMEOUT`.                                                                                                                                |
| Degradación         | Circuito: `AI_CIRCUIT_FAILURES` fallas seguidas → 503 sin llamar durante `AI_CIRCUIT_COOLDOWN_MS`. La cuota no lo abre.                                                      |

**Personalización.** El prompt está escrito para un dueño de comercio sin conocimientos técnicos: máximo 2 oraciones con voseo, sin palabras como score, puntos o proporción (el detalle numérico ya se ve en pantalla), cada motivo traducido a la vida diaria ("faltó a todos sus turnos anteriores") y hasta 3 recomendaciones cortas que empiezan con un verbo. No pide otra confirmación si el cliente ya confirmó.

**Explicación automática.** El detalle del turno muestra la explicación al abrirse, sin botón. El servidor la guarda por versión del score (negocio, turno, fecha de cálculo y modelo; hasta 500 entradas por 24 h), así que volver a entrar no llama a Gemini ni consume el límite. Al confirmar, reprogramar o cerrar el turno el panel la vuelve a pedir y, si el score cambió, se genera una nueva. "Generar de nuevo" fuerza otra (`refresh=true`) y sí consume el límite. Confirmar un turno (desde el negocio o por el enlace del correo) agrega el factor `CUSTOMER_CONFIRMED` (-25) en la misma transacción, sin recalcular la anticipación medida al reservar. El seed calcula los scores con el mismo calculador, así la demo muestra factores reales.

Si Gemini falla, sólo la explicación responde error: el score persistido, la agenda y los turnos siguen funcionando. Los logs de IA registran modelo, intento, duración y tipo de falla, nunca el prompt ni la respuesta.

En local, `docker:dev` toma `GEMINI_API_KEY` y `GEMINI_MODEL` de `.env.dev` (ignorado por Git).

## Observabilidad y resiliencia (FINAL-08)

- **Correlación:** cada request tiene `x-request-id` (se acepta el del cliente si es válido). Todas las líneas de log son JSON con `service`, `sha` y `requestId`.
- **Datos sensibles:** el logger reemplaza por `[redacted]` cualquier campo cuyo nombre contenga token, password, secret, authorization, cookie, api key, prompt, email, phone o notes.
- **Versión:** `/health` y `/metrics` informan el SHA (`RENDER_GIT_COMMIT`, luego `RELEASE_SHA`, luego `GITHUB_SHA`).
- **Métricas protegidas:** con `METRICS_TOKEN` (≥ 32 caracteres), `/metrics` exige `Authorization: Bearer <token>`; sin token responde 404 en producción y queda abierto en desarrollo.
- **Contenido de `/metrics`:** requests, errores 5xx, requests lentas (≥ 2 s), conteo por estado, llamadas de IA por resultado y fallas de `/ready`.

### Alertas sugeridas

| Señal                                | Fuente                                      | Acción                                      |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------- |
| `/ready` 503 dos veces seguidas      | Monitor HTTP externo (Render / UptimeRobot) | Revisar conexión a PostgreSQL y migraciones |
| Log `dependency_unavailable`         | Logs de Render / App Service                | Ídem                                        |
| Log `ai_circuit_open`                | Logs                                        | Revisar cuota y estado de Gemini            |
| `errors` o `slowRequests` en aumento | `/metrics` con token                        | Revisar logs por `requestId`                |

### Ensayo aislado de caídas

| Caída | Cómo simular en local                            | Resultado esperado                                                                                  |
| ----- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| DB    | `docker stop turnosmart-local-postgres-1`        | `/health` 200, `/ready` 503 + `dependency_unavailable`; el frontend muestra el error con reintento. |
| IA    | `GEMINI_API_KEY` inválida en `.env.dev`          | Explicación 503/502; tras 3 fallas, `ai_circuit_open`; la agenda sigue operando.                    |
| API   | Detener el backend (`Ctrl+C` del proceso de API) | El frontend muestra "No se pudo cargar tu cuenta" con Reintentar y Cerrar sesión.                   |

## Evidencia pendiente en entorno publicado

- Invitación real de un OWNER, aceptación, recuperación y enlace vencido con el SMTP del proyecto.
- `migrate deploy` de las dos migraciones nuevas en Dev y luego Production (coordinado con Nati).
- Consulta con la clave pública a `/rest/v1/customers` con un JWT de OWNER: debe responder 401/403.
- Una explicación real de Gemini en el entorno publicado y el ensayo de caída de IA.
- `/metrics` con y sin token, y el SHA de `/health` igual al del deploy.
