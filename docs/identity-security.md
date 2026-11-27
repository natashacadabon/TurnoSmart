# Identidad, seguridad, IA y observabilidad

Bloques FINAL-10, FINAL-02, FINAL-05B y FINAL-08 (Yae). Describe el comportamiento del código en la rama `feat/final-yae-identidad-seguridad-ia`. La aceptación en un entorno publicado requiere la evidencia indicada al final.

## Modelo de roles

Base: modelo de Sofi (PR #36, migración `20261126000100_global_platform_admin`). Los roles viven en `profiles` y no comparten permisos.

| Rol   | En `profiles`                      | Alcance                                                                                                                                                                                    |
| ----- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADMIN | `role = ADMIN`, `business_id` NULL | Administrador global. Alta y estado de negocios, invitación y gestión de propietarios. No pertenece a un negocio y no opera clientes, servicios, agenda, turnos, riesgo ni notificaciones. |
| OWNER | `role = OWNER`, `business_id` fijo | Operación diaria de su negocio. No crea otros OWNER, no desactiva propietarios ni accede al panel de la plataforma.                                                                        |
| STAFF | Legado                             | Sin permisos. La migración `20261126000200_profile_access_rules` lo deja desactivado.                                                                                                      |

- `20261126000100` (Sofi) hace `business_id` opcional y desliga del negocio a los ADMIN existentes: pasan a ser ADMIN globales.
- `20261126000200` (Yae) agrega `active`/`deactivated_at` (un CHECK exige la fecha cuando el perfil está inactivo), desactiva los STAFF y fija en la base la regla `(role = 'ADMIN') = (business_id IS NULL)`.
- Cuentas demo: `admin@turnosmart.test` es el ADMIN global y `owner@turnosmart.test` el OWNER del negocio 1; ambas usan la contraseña local del seed. `owner2@turnosmart.test` es OWNER del negocio 2.

### Matriz de permisos

Fuente única: `PERMISSIONS` en `packages/shared/src/identity.ts`.

| Permiso                                                                                                          | ADMIN | OWNER |
| ---------------------------------------------------------------------------------------------------------------- | :---: | :---: |
| `business:update`, `services:*`, `availability:*`, `slots:read`, `customers:*`, `appointments:*`, `risk:explain` |   —   |   ✓   |
| `platform:businesses`, `platform:owners` (panel de la plataforma, FINAL-11)                                      |   ✓   |   —   |

### Resolución en la API

| Middleware             | Acepta       | Rechaza                                                                                         |
| ---------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `authenticate`         | Token válido | 401 `UNAUTHENTICATED` / `TOKEN_INVALID`                                                         |
| `requireProfile`       | OWNER activo | 403 `FORBIDDEN` (ADMIN), 403 `ACCOUNT_DISABLED` (inactivo), 403 `PROFILE_REQUIRED` (sin perfil) |
| `requirePlatformAdmin` | ADMIN activo | 403 `FORBIDDEN` (OWNER), 403 `ACCOUNT_DISABLED`, 403 `PROFILE_REQUIRED`                         |

El negocio siempre sale de `profiles`; `role` o `businessId` enviados en el body se ignoran.

`GET /api/me` responde `access: 'OWNER' | 'ADMIN' | 'NONE'` (con `reason: 'NO_PROFILE' | 'DISABLED'`) y conserva los campos de Sofi: `platformAdmin` y `business: null` para el ADMIN. `onboarded` sigue siendo `true` sólo para un OWNER activo.

## Registro, invitación y recuperación (FINAL-10)

Como pide el backlog, hay dos formas de que un OWNER llegue a su negocio: el registro público (cuenta nueva, verificación de correo y onboarding) y la invitación de un ADMIN (FINAL-11).

| Ruta               | Uso                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `/login`           | Ingreso. Redirige por rol: OWNER → `/customers`, ADMIN → `/admin`, sin perfil → `/onboarding`, desactivado → `/sin-acceso`. |
| `/register`        | Registro público con contraseña (≥ 10, letras y números) y correo de verificación a `/auth/callback?flow=verify`.           |
| `/onboarding`      | Alta del negocio por una cuenta verificada sin perfil; ADMIN y cuentas desactivadas son redirigidas.                        |
| `/forgot-password` | Pide el correo de recuperación. Siempre muestra el mismo mensaje para no revelar si la cuenta existe.                       |
| `/auth/callback`   | Destino de los enlaces de correo. Lee `?flow=` y errores de Supabase (`otp_expired`, `access_denied`).                      |
| `/reset-password`  | Nueva contraseña (≥ 10 caracteres, letras y números). `?flow=invite` muestra "Creá tu contraseña".                          |
| `/sin-acceso`      | Cuenta desactivada o STAFF legado.                                                                                          |
| `/admin`           | Entrada del ADMIN. El panel completo es FINAL-11.                                                                           |

Enlace vencido o ya usado: `/auth/callback` muestra "El enlace venció" o "no es válido". En recuperación ofrece pedir otro; en invitación indica pedir el reenvío al ADMIN. Sin sesión válida, `/reset-password` no permite cambiar la contraseña.

### Contrato con FINAL-11 (invitaciones, Sofi)

1. El backend del panel crea el negocio y el perfil `OWNER` (`active = true`) con el mismo `id` que devuelve Auth.
2. La invitación usa `auth.admin.inviteUserByEmail(email, { redirectTo: '<frontend>/auth/callback?flow=invite' })`. Reenviar = volver a invitar; revocar = borrar el usuario de Auth si nunca aceptó, o desactivar el perfil.
3. Aceptar la invitación verifica el correo; el OWNER define su contraseña en `/reset-password?flow=invite` y entra a su negocio.
4. Las rutas del panel usan `authenticate` + `requirePlatformAdmin` y los permisos `platform:*`. Hace falta la clave de servicio de Supabase en el backend sólo para invitar.
5. Desactivar un OWNER: `active = false` y `deactivated_at = now()`. La API lo rechaza en el siguiente request. Para cortar también la sesión de Auth, revocarla con la API admin.

### Configuración de Auth (Nati)

En cada proyecto de Supabase (Dev y Production):

- Site URL: el origen HTTPS del frontend de ese entorno.
- Redirect URLs: `<origen>/auth/callback` (y el patrón de Preview de Vercel en Dev).
- Email signups habilitados con confirmación de correo obligatoria; vencimiento OTP de 3600 s; contraseña mínima de 10.
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

El frontend usa Supabase sólo para Auth; los datos pasan por Express, que conecta con el rol dueño de las tablas. La migración `20261126000300_close_data_api_access`:

- Revoca todos los privilegios de `anon`, `authenticated` y `PUBLIC` sobre tablas, secuencias y funciones de `public`, y los privilegios por defecto para objetos futuros.
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
