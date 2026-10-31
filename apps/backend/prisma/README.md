# Seed de desarrollo: Supabase local y Cloud

Se conserva el comando del workspace, desde la raiz Git:

```sh
npm run prisma:seed --workspace=@turnosmart/backend
```

No se ejecuta automaticamente durante Docker startup, arranque de la API o
migraciones. No aplica migraciones, no borra registros y no modifica archivos
`.env` reales. Las migraciones existentes y Prisma Client deben estar preparados.
El seed carga `apps/backend/.env` sin sobrescribir las variables de la terminal.

## Supabase local

Hace falta Supabase local con Auth y PostgreSQL disponibles. Compose de las apps
no lo provee por si solo. `DATABASE_URL`, `SUPABASE_URL` y `DIRECT_URL`, si esta
ultima se define, deben ser locales: localhost, 127.0.0.1 o ::1. Este flujo no
requiere habilitacion remota ni confirmacion de Project Ref.

En PowerShell 7, introducir los valores sin mostrarlos ni guardarlos como
comandos en el historial:

```powershell
$env:NODE_ENV = 'development'
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:DATABASE_URL = Read-Host 'DATABASE_URL del PostgreSQL local' -MaskInput
$env:DIRECT_URL = $env:DATABASE_URL
$env:SUPABASE_ANON_KEY = Read-Host 'Anon o publishable key local' -MaskInput
$env:SUPABASE_SECRET_KEY = Read-Host 'Secret o service_role key local (solo backend)' -MaskInput
$env:SEED_ADMIN_PASSWORD = Read-Host 'Password del administrador (minimo 10 caracteres)' -MaskInput
npm run prisma:seed --workspace=@turnosmart/backend
```

Ajustar el puerto local al entorno real. `SUPABASE_SECRET_KEY` tiene prioridad
sobre `SUPABASE_SERVICE_ROLE_KEY`; si la primera esta vacia se conserva el
fallback existente. La clave privilegiada nunca debe ir al frontend ni a
variables `NEXT_PUBLIC_*`.

## Supabase Cloud de desarrollo

El unico Project Ref autorizado es **gtghqinpghiryxuloeub**, registrado en
`seed-targets.ts` por indicacion expresa de la desarrolladora el 2026-10-30.
Agregar otro destino requiere editar y revisar esa lista: no se acepta un host
remoto arbitrario ni una lista enviada por variables de entorno.

Antes de cualquier conexion o escritura se exige:

1. `NODE_ENV` distinto de production, tambien si tiene espacios o mayusculas.
2. `ALLOW_REMOTE_SEED=true` exactamente; no se aceptan TRUE ni valores similares.
3. `SUPABASE_URL=https://<Project Ref autorizado>.supabase.co`, sin credenciales,
   paths adicionales, query, fragmentos o puertos alternativos.
4. `DATABASE_URL` y `DIRECT_URL` obligatorias, ambas del mismo proyecto del API.
   No se admiten mezclas entre local y Cloud.
5. Confirmacion explicita del destino:
   `SEED_CONFIRM_REMOTE=seed:gtghqinpghiryxuloeub`.

Se reconocen conexiones directas/dedicated pooler en `db.<ref>.supabase.co`
con usuario postgres, y shared poolers oficiales `aws-<indice>-<region>.pooler.supabase.com`
con usuario `postgres.<ref>`. En el pooler el Project Ref se obtiene del usuario,
no de la region. `DATABASE_URL` admite 5432 o 6543; `DIRECT_URL` debe ser directa
o de sesion, puerto 5432. La base es postgres y el schema, si se informa, public.
Copiar las URLs del panel Connect del proyecto; no inventar un host de pooler.

Se permiten los parametros habituales de Prisma: pgbouncer, schema, sslmode,
sslaccept, connection_limit, pool_timeout, connect_timeout, socket_timeout y
statement_cache_size. Se rechazan claves repetidas, parametros de redireccion
como host y schemas alternativos. URLs personalizadas o roles de DB distintos
de postgres no estan soportados por este seed.

Comando completo, **para ejecutar manualmente cuando se decida cargar ese
proyecto de desarrollo**. Este cambio no ejecuta la carga Cloud:

```powershell
$env:NODE_ENV = 'development'
$env:SUPABASE_URL = 'https://gtghqinpghiryxuloeub.supabase.co'
$env:DATABASE_URL = Read-Host 'DATABASE_URL de ese proyecto (Connect)' -MaskInput
$env:DIRECT_URL = Read-Host 'DIRECT_URL del mismo proyecto (5432)' -MaskInput
$env:SUPABASE_ANON_KEY = Read-Host 'Anon o publishable key del proyecto' -MaskInput
$env:SUPABASE_SECRET_KEY = Read-Host 'Secret key del backend (sb_secret_... o service_role)' -MaskInput
$env:SEED_ADMIN_PASSWORD = Read-Host 'Password elegida u original del administrador' -MaskInput
$env:ALLOW_REMOTE_SEED = 'true'
$env:SEED_CONFIRM_REMOTE = 'seed:gtghqinpghiryxuloeub'
try {
  npm run prisma:seed --workspace=@turnosmart/backend
} finally {
  Remove-Item Env:ALLOW_REMOTE_SEED, Env:SEED_CONFIRM_REMOTE -ErrorAction SilentlyContinue
}
```

La confirmacion nombra el proyecto concreto y es independiente de la habilitacion
remota. El seed muestra solo el Project Ref autorizado, nunca las cadenas de
conexion ni secretos. Cerrar la terminal al terminar para quitar las variables
sensibles restantes de esa sesion. Nunca configurar estas opciones para produccion.

`sb_secret_...` se pasa como API key a `createClient` del SDK instalado, sin
intentar decodificarlo como JWT ni escribir Authorization manualmente. La clave
privilegiada se usa solo en `auth.admin`; login se verifica con la clave publica.
Ver [API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Auth Admin](https://supabase.com/docs/reference/javascript/admin-api) y
[formatos de conexion](https://supabase.com/docs/guides/database/connecting-to-postgres).
El proveedor verifica la validez y permisos de las claves: la validacion de URLs
no prueba la validez de una credencial.

## Cuenta, datos e idempotencia

La cuenta es **admin@turnosmart.test**, rol **OWNER** de Demo TurnoSmart 1.
Se crea con Supabase Auth Admin y email confirmado, sin SQL sobre auth.users.
La password es la elegida en `SEED_ADMIN_PASSWORD`, minimo 10 caracteres: guardar
ese valor en un gestor. Si la cuenta ya existe, se reutiliza **sin cambiar la
password**; para comprobar login se debe ingresar la original.

Las otras cuentas tienen roles OWNER/ADMIN/STAFF y passwords nuevas aleatorias
que no se publican. Si ya existen tampoco se cambian sus credenciales. El seed
verifica `signInWithPassword`, el token con `getUser` y el perfil OWNER. Frontend
y backend deben apuntar al mismo proyecto para usar http://localhost:3000/login.
Verificar en la respuesta de `GET /api/me` que `onboarded` sea true y
`profile.role` OWNER; no copiar ni publicar el header Authorization.

Cantidades por carga: 2 negocios, 6 perfiles/usuarios Auth, 8 clientes, 8 servicios,
20 franjas semanales y 10 turnos; ademas 10 eventos, 10 riesgos ficticios y 10
recordatorios CANCELLED para no activar envios. Los turnos son relativos al dia
habil anterior o siguiente, con una agenda por negocio y sin solapamientos activos.

Los upserts usan IDs reservados del seed, separados del seed antiguo. No se
reasignan perfiles de otro negocio/rol ni se mueven registros con IDs ajenos.
Los fixtures reservados pueden volver a sus valores de demostracion al repetir;
los registros ajenos al seed permanecen intactos. Ante conflicto con un turno
manual, las escrituras de negocio se revierten en la transaccion Serializable.
No ejecutar mientras se editan esos datos de demostracion.

Auth y PostgreSQL no comparten transaccion: puede quedar una cuenta Auth creada
si falla una fase posterior. No se elimina; la siguiente ejecucion la reutiliza.
Las variables antiguas SEED_AUTH_USER_ID y SEED_AUTH_USER_EMAIL no se utilizan.

## Diagnosticos seguros al fallar

El seed informa la etapa y conserva codigos permitidos sin imprimir el error
original. No hace falta activar DEBUG ni mostrar el stack, las URLs completas,
los parametros SQL o la respuesta completa de Auth.

Ejemplo ilustrativo, no un resultado observado contra Cloud:

```json
{
  "event": "seed_failed",
  "stage": "services",
  "type": "PrismaClientKnownRequestError",
  "code": "P2002",
  "message": "Conflicto de unicidad. Puede existir un registro con el mismo nombre/email y otro ID; no se fusionan ni sobrescriben filas ajenas."
}
```

| Etapa                                              | Que revisar                                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| configuration                                      | Lista de proyectos, triple coincidencia de URLs, habilitacion, confirmacion y variables requeridas.                                                        |
| prisma_connection                                  | P1000: credenciales PostgreSQL; P1001: red/DNS/IPv4/IPv6; P1011: TLS; P1013: formato/codificacion de URL.                                                  |
| migrations                                         | Comprobacion SELECT con LIMIT 0 sobre las tablas requeridas, antes de crear usuarios. SQLSTATE 42P01 indica tabla ausente; 42501 indica falta de permisos. |
| supabase_auth                                      | Consulta de usuarios o configuracion del cliente Auth; revisar codigo y status HTTP.                                                                       |
| user_creation                                      | Alta mediante Auth Admin; por ejemplo not_admin, weak_password, email_address_invalid o limites del proveedor.                                             |
| auth_login                                         | Credenciales, confirmacion o token. Una cuenta existente conserva su password original.                                                                    |
| profiles / businesses                              | Conflictos con perfiles de otro negocio/rol o IDs de negocios reservados.                                                                                  |
| customers / services / availability / appointments | Restricciones de cada entidad: P2002 unicidad, P2003 relacion, P2004 CHECK, P2021 tabla y P2022 columna.                                                   |
| appointment_events / risk_scores / reminders       | Restricciones de los datos complementarios.                                                                                                                |
| data_validation                                    | Turnos activos superpuestos con datos existentes; la transaccion se revierte.                                                                              |
| transaction_begin / transaction_commit             | Fallo al abrir/confirmar la transaccion; P2028 timeout/transaccion o P2034 conflicto concurrente.                                                          |
| disconnect                                         | Error al cerrar el cliente. Si ya habia otro fallo, se informa separado como seed_cleanup_failed y se conserva seed_failed original.                       |

La comprobacion migrations solo lee estructura y permisos de tablas: no aplica
migraciones, no lee filas, ni certifica historial, checksums o todas las columnas.
Los fallos posteriores conservan su etapa y codigo. La clave privilegiada de Auth
no otorga permisos al usuario PostgreSQL de Prisma: son credenciales separadas.

La idempotencia no resuelve automaticamente un registro manual con el mismo
nombre/email pero otro ID, ni un perfil asociado a otro negocio. Esos conflictos
se informan sin eliminar, fusionar, reasignar ni modificar datos ajenos. Solo
se intenta recuperar una carrera Auth cuando el proveedor indica usuario/email
ya existente; otros errores conservan su codigo y status originales seguros.

Con las URLs, claves y password configuradas segun las secciones anteriores,
volver a ejecutar manualmente para obtener el diagnostico:

```powershell
$env:NODE_ENV = 'development'
$env:ALLOW_REMOTE_SEED = 'true'
$env:SEED_CONFIRM_REMOTE = 'seed:gtghqinpghiryxuloeub'
try {
  npm run prisma:seed --workspace=@turnosmart/backend
} finally {
  Remove-Item Env:ALLOW_REMOTE_SEED, Env:SEED_CONFIRM_REMOTE -ErrorAction SilentlyContinue
}
```

Conservar la ultima linea JSON seed_failed (sin agregar salidas DEBUG). La causa
operativa de un fallo remoto no se da por comprobada hasta obtener ese resultado:
las pruebas locales reproducen codigos y etapas, no ejecutan la carga Cloud.

## Validaciones sin ejecutar Cloud

```sh
npm run lint
npm run typecheck
npm test
```

La suite del seed usa dobles para verificar dos ejecuciones sin duplicados,
relaciones, aislamiento, fechas, solapamientos y rollback. Tambien prueba
proyectos remotos rechazados, confirmacion ausente/incorrecta, mezcla de destinos,
referencias cruzadas en conexiones directas/poolers, hosts falsos, parametros
no admitidos y produccion. Una llamada del SDK Auth Admin con una clave de formato
sb_secret se prueba con fetch simulado: no hay red ni credenciales reales.

Estas pruebas no certifican la carga ni la autenticacion contra un proyecto
real. En esta tarea no se ejecuta el seed contra Cloud ni se crean usuarios remotos.
