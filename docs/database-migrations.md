# Migraciones Prisma manuales por entorno

El workflow **Migraciones de base de datos** (`database-migrate.yml`) permite
consultar o aplicar los archivos existentes sin preparar variables en PowerShell.
No se ejecuta por push/PR ni forma parte del arranque de Render. No modifica
migraciones históricas, despliegues ni datos durante su implementación/pruebas.

## Configuración única en GitHub

En **Settings → Environments**, crear/configurar estos environments independientes:

Estado consultado por API GitHub el 26/11/2026: ambos environments ya existen.
`database-production` tiene una política de branch **main**; conservarla.
**`database-dev` no tiene restricciones de ramas**: antes de habilitar el uso,
seleccionar **Selected branches and tags → Add deployment branch or tag rule →
Branch → dev**. No permitir todas las ramas ni tags. Esta barrera impide que
una definición de workflow modificada en una feature solicite los secrets; los
guards del código no sustituyen la política de GitHub. No se cambió remotamente.
La presencia/valor de secrets y variables de esos environments no se inspeccionó.

| Campo                        | `database-dev`                                              | `database-production`                                              |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Deployment branches and tags | Selected branches and tags: **branch `dev` solamente**      | Selected branches and tags: **branch `main` solamente**            |
| Secret `DATABASE_URL`        | DSN PostgreSQL de Supabase Dev, con TLS                     | DSN PostgreSQL de Supabase Production, con TLS                     |
| Secret `DIRECT_URL`          | Conexión directa o session pooler Dev, puerto 5432, con TLS | Conexión directa o session pooler Production, puerto 5432, con TLS |
| Variable `SUPABASE_URL`      | `https://gtghqinpghiryxuloeub.supabase.co`                  | `https://rujwxzsyrqibefuhdgjd.supabase.co`                         |

En **Settings → Secrets and variables → Actions → Variables**, conservar:

- `EXPECTED_DEV_SUPABASE=https://gtghqinpghiryxuloeub.supabase.co`.
- `EXPECTED_PRODUCTION_SUPABASE=https://rujwxzsyrqibefuhdgjd.supabase.co`.

Estas dos variables ya existen: no duplicarlas ni sustituirlas por credenciales.
No sobreescribirlas con otros valores en los environments. `SUPABASE_URL` sí debe
estar definida explícitamente en cada environment de base, aunque haya un valor
de repositorio: el valor equivocado se rechaza, no se corrige con fallbacks.

Los DSN se obtienen en **Supabase → proyecto correspondiente → Connect**. No
publicarlos en Issues, PR, logs, variables públicas ni archivos versionados.
Usar base `postgres`, usuario `postgres` en conexión directa o
`postgres.<project-ref>` en pooler y `sslmode=require` (o `verify-ca`/`verify-full`).
No usar `sslaccept=accept_invalid_certs`. `DIRECT_URL` nunca admite el transaction
pooler (6543); en runners sin IPv6 utilizar **Session pooler 5432**, sin pagar IPv4.
No cambiar el host/usuario o proyecto sólo para hacer pasar la validación.

No hacen falta `SUPABASE_ANON_KEY`, claves service-role, tokens Vercel/Render ni
un PAT de GitHub. El token efímero del workflow sólo tiene `contents: read` y
`actions: read`. Los secretos DB se inyectan únicamente en el paso Prisma y los
tokens GitHub no se transmiten al subprocess de Prisma.

Las políticas de ramas son obligatorias para impedir que una definición modificada
en una feature/PR solicite secretos. Mantener Dev/Main protegidas y Quality Checks.
Si el plan/repositorio permite revisores de environment, se puede añadir revisión
humana de `database-production`; no es requisito de un servicio pago. No cambiar
la default branch Dev. No se crearon environments ni secretos desde esta tarea.

## Consultar (`status`, opción predeterminada)

1. Integrar la PR en Dev después de CI. El workflow debe existir en default Dev
   para aparecer en Actions; para Production debe estar también integrado en Main.
2. **Actions → Migraciones de base de datos → Run workflow**.
3. Seleccionar rama **dev** + environment **dev**, o rama **main** + environment
   **production**. Nunca una feature, PR, tag ni una combinación cruzada.
4. Seleccionar **operation=status** y ejecutar. Si hay aprobaciones configuradas,
   aprobar únicamente el SHA y entorno esperados.
5. Consultar **Summary**: entorno, SHA completo, operación, fase, número de
   migraciones locales, nombres pendientes y resultado.

`status` ejecuta `npm run prisma:status --workspace=apps/backend`, que llama
`prisma migrate status`. **Pendientes no equivale a error**: el workflow termina
correctamente con resultado `pendientes` si reconoce exactamente ese caso de
Prisma 6.12. Un error de conexión, historial divergente, migración fallida, tabla
de migraciones ausente, interrupción o salida desconocida bloquea la operación.
No se muestra la salida cruda del CLI: puede contener conexiones o mensajes SQL.
El resumen indica la fase para diagnosticar en un canal privado autorizado.

Ante validaciones rechazadas, el resumen y el log incluyen **Variable**, **Tipo
de error** (código estable) y **Diagnóstico**, además de la fase exacta. Por ejemplo,
una conexión sintética sin TLS informa `DIRECT_URL / TLS_REQUIRED` en
`validación del destino`, sin mostrar host, usuario, password ni el DSN. Una
variable vacía informa `MISSING_VARIABLE`; formato inválido `INVALID_URL`;
proyecto cruzado `PROJECT_MISMATCH`; pooler 6543 `TRANSACTION_POOLER`. Corregir
únicamente el secret/variable indicado en el environment correspondiente y crear
una ejecución nueva de `status` después de aprobar/integrar el cambio.

El diagnóstico usa metadata estructurada del validador existente, nunca interpreta
ni imprime `error.message`, stack, cause o salida SQL privada. Excepciones no
reconocidas muestran `UNEXPECTED_ERROR`, sin inventar una variable responsable.

Auditoría del fallo Dev/status [45921255276](https://github.com/natashacadabon/TurnoSmart/actions/runs/45921255276):
preflight e instalación aprobaron; el fallo ocurrió antes de Prisma. Las cinco
variables estaban presentes en logs, los DSN enmascarados y las URLs públicas
eran canónicas y coherentes con Dev. El código anterior descartaba el motivo del
validador. No se pudo atribuir retrospectivamente el fallo a un secret concreto;
el contador de diez migraciones es informativo, no evidencia de un fallo SQL.
La corrección mejora el diagnóstico sin debilitar validaciones ni modificar secrets.

La clasificación está ligada a Prisma 6.12 fijado en el lockfile. Si se actualiza
Prisma, comprobar el contrato de salida y las regresiones antes de publicar.
No es una auditoría de drift, integridad de datos ni recuperación de Supabase Auth.

## Aplicar (`deploy`, selección explícita)

1. Revisar las migraciones versionadas y su compatibilidad con el backend vigente.
   Consultar primero `status`. Disponer de backup verificado y procedimiento de
   recuperación según [operaciones](operations.md); no repetir migraciones aplicadas.
2. Para Production, esperar **la última CI por push exitosa del SHA exacto de Main**.
   Una CI de PR, anterior, fallida o en ejecución no autoriza escrituras. Dev no
   exige ese gate adicional: la integración en rama protegida conserva su CI habitual.
3. Crear una **ejecución nueva** con la rama/entorno correctos y **operation=deploy**.
   No re-run de un SHA antiguo ni cambiar variables para eludir un bloqueo.
4. El workflow valida contexto y destino, comprueba la rama actual, consulta estado
   y vuelve a comprobar SHA/CI inmediatamente antes de llamar al script existente
   `npm run prisma:migrate --workspace=apps/backend` (`prisma migrate deploy`).
5. Ejecuta otro `migrate status`. Sólo informa **aplicado y verificado** si deploy
   terminó con código 0 y no quedaron pendientes.
6. Continuar con el despliegue backend/frontend por sus mecanismos existentes y
   validar `/health`, `/ready` y compatibilidad funcional. Este workflow no publica
   aplicaciones ni altera sus reglas de promoción.

## Concurrencia, fallos y recuperación

- Una cola por environment/base, compartida por status/deploy de ese entorno:
  `database-migrate-dev` y `database-migrate-production`, `cancel-in-progress: false`.
  Las ejecuciones esperan su turno y vuelven a comprobar vigencia tras esperar.
- No cancelar manualmente una migración en curso. Hay un límite de job de 45 min;
  cierre de runner, fallo de red o SQL pueden dejar estado parcial. No se garantiza
  atomicidad de todo el historial: depende de los SQL y de PostgreSQL/Prisma.
- El control de SHA reduce la ventana de carrera, pero GitHub y PostgreSQL no
  comparten una transacción; coordinar merges mientras se aplica una release.
- No hay reintento automático de deploy, reset, db push, migrate dev ni resolve.
  Ante fallo, consultar estado en una ejecución nueva e investigar antes de actuar.
  Un resumen `fallido` después de deploy puede significar que hubo escrituras y
  falló la verificación final: no asumir rollback automático.
- El bootstrap/baseline de una base sin historial requiere revisión separada.
  La [estrategia de rollback](operations.md) distingue código, esquema y datos;
  las migraciones incompatibles existentes no se modifican ni revierten aquí.
- Credenciales con permisos de migración pueden escribir; seleccionar status
  restringe el comando, no crea un rol SQL de sólo lectura. El aislamiento depende
  también de proteger ramas, environments y cuentas mantenedoras.

## Validación del cambio

Las regresiones se ejecutan con `npm run test:migrations` y forman parte de
`npm test`, sin modificar los workflows de CI/deploy actuales. Cubren ramas,
opciones, secretos ausentes, destinos cruzados, TLS, DIRECT_URL, CI/SHA, comandos,
errores y resumen sin credenciales. Usan dobles; un smoke del CLI real sólo intenta
conectar a `127.0.0.1:1` para comprobar carga de config y rechazo de conexión. Nunca conecta
con Supabase remoto. Los resultados ejecutados se registran en la PR.

Fuentes: [Prisma 6: referencia CLI](https://www.prisma.io/docs/orm/v6/reference/prisma-cli-reference)
y la implementación instalada de `prisma@6.12.0`. Se reutiliza el validador
`assertSupabaseTarget` de `prisma.config.ts`, sin duplicar sus reglas de identidad/TLS.
