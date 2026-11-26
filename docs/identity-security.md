# Identidad, seguridad, IA y observabilidad

Bloques FINAL-10, FINAL-02, FINAL-05B y FINAL-08 (Yae). Describe el comportamiento del código en la rama `feat/final-yae-identidad-seguridad-ia`. La aceptación en un entorno publicado requiere la evidencia indicada al final.

## Modelo de roles

Hay dos roles, sin permisos compartidos.

| Rol   | Dónde vive                                 | Alcance                                                                                                                                                                                    |
| ----- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADMIN | `platform_admins` (id = `auth.users.id`)   | Administrador global. Alta y estado de negocios, invitación y gestión de propietarios. No pertenece a un negocio y no opera clientes, servicios, agenda, turnos, riesgo ni notificaciones. |
| OWNER | `profiles` (`role = OWNER`, `business_id`) | Operación diaria de su negocio. No crea otros OWNER, no desactiva propietarios ni accede al panel de la plataforma.                                                                        |

- `ProfileRole` sólo admite `OWNER`. STAFF y el ADMIN por negocio ya no existen.
- `profiles.active` y `platform_admins.active` permiten desactivar sin borrar historial. Un CHECK exige `deactivated_at` cuando la cuenta está inactiva.
- La migración `20261126000200_platform_admin_owner_roles` convierte los perfiles ADMIN/STAFF existentes en OWNER **desactivados**: conservan historial y lecturas de notificaciones, sin acceso hasta que un ADMIN los reactive.
- Si por error una cuenta es ADMIN y OWNER, se resuelve como ADMIN y no puede operar el negocio.

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

`GET /api/me` responde `access: 'OWNER' | 'ADMIN' | 'NONE'` (con `reason: 'NO_PROFILE' | 'DISABLED'`). `onboarded` sigue siendo `true` sólo para un OWNER activo, para no cambiar las pantallas del negocio.

## Acceso, invitación y recuperación (FINAL-10)

No hay registro público: `POST /api/onboarding` y `/onboarding` se eliminaron, y GoTrue local tiene `DISABLE_SIGNUP`. Un OWNER entra sólo por invitación de un ADMIN.

| Ruta               | Uso                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `/login`           | Ingreso. Redirige por rol: OWNER → `/customers`, ADMIN → `/admin`, sin acceso → `/sin-acceso`.         |
| `/forgot-password` | Pide el correo de recuperación. Siempre muestra el mismo mensaje para no revelar si la cuenta existe.  |
| `/auth/callback`   | Destino de los enlaces de correo. Lee `?flow=` y errores de Supabase (`otp_expired`, `access_denied`). |
| `/reset-password`  | Nueva contraseña (≥ 10 caracteres, letras y números). `?flow=invite` muestra "Creá tu contraseña".     |
| `/sin-acceso`      | Cuenta sin perfil o desactivada.                                                                       |
| `/admin`           | Entrada del ADMIN. El panel completo es FINAL-11.                                                      |

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
- Email signups deshabilitados; confirmación de correo habilitada; vencimiento OTP de 3600 s; contraseña mínima de 10.
- SMTP propio (Resend) para que invitaciones y recuperación no dependan del límite del SMTP de prueba de Supabase.

En local, `npm run docker:dev` levanta Mailpit: los correos de Auth se ven en `http://localhost:54327` y nunca salen de la máquina.

## Data API y RLS (FINAL-02)

El frontend usa Supabase sólo para Auth; los datos pasan por Express, que conecta con el rol dueño de las tablas. La migración `20261126000300_close_data_api_access`:

- Revoca todos los privilegios de `anon`, `authenticated` y `PUBLIC` sobre tablas, secuencias y funciones de `public`, y los privilegios por defecto para objetos futuros.
- Habilita RLS en todas las tablas (incluida `platform_admins`) como segunda barrera.
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

**Personalización.** El prompt pide citar cada factor con su valor y su aporte al score, ordenar las recomendaciones por impacto y no pedir otra confirmación si el cliente ya confirmó. Confirmar un turno (desde el negocio o por el enlace del correo) agrega el factor `CUSTOMER_CONFIRMED` (-25) en la misma transacción, sin recalcular la anticipación medida al reservar. El seed calcula los scores con el mismo calculador, así la demo muestra factores reales.

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
