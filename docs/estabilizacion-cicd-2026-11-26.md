# Estabilización de CI/CD — 26/11/2026

## Diagnóstico y alcance

Los backends vigentes funcionan. Los indicadores rojos no representan una caída
general: mezclan un servicio Render antiguo, una regresión del preflight Preview
y promociones Production fallidas. El dominio Production está configurado, pero
Vercel muestra **No Production Deployment / No Deployment**. No se publicaron
deployments ni se modificó infraestructura durante esta auditoría.

Rama de corrección: `fix/estabilizar-despliegues`, creada desde `origin/dev`
actualizado. Se integra `origin/main` mediante merge local, conservando sus padres.
No hay cambios funcionales, de dependencias, base de datos o migraciones.

## Inventario comprobado

| Recurso             | URL / identidad                                                | Evidencia del 26/11                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend Dev        | https://turnosmart-dev-1361343811.vercel.app                   | Recurso vigente indicado por el usuario; acceso anónimo redirige a SSO de Vercel (302). No acredita login funcional de la aplicación.                                         |
| Backend Dev         | https://turnosmart.onrender.com                                | `/health` y `/ready`: HTTP 200; SHA `b7a9380fa1a1d4d5bd9a2d73bce7c7d2bf78a2e8`, coincide con Dev auditado. Settings: rama Dev, Auto-Deploy On Commit, sin filtros de build.   |
| Backend Production  | https://turnosmart-backend-prod.onrender.com                   | `/health` y `/ready`: HTTP 200; SHA `7e0260e3945f0881bc48c2f43c1e7fb10df084e4`, coincide con Main auditado. Settings: rama Main, Auto-Deploy On Commit, sin filtros de build. |
| Frontend Production | https://turno-smart-neon.vercel.app                            | `/login`: HTTP 404. Dominio asociado a Production, sin deployment asignado en dashboard.                                                                                      |
| Vercel              | Equipo `natcads-projects`, proyecto `turno-smart`              | Hobby; proyecto único. Preview READY visible en dashboard. Git no conectado según overview; `git.deploymentEnabled=false` en repositorio.                                     |
| Supabase Dev        | `gtghqinpghiryxuloeub.supabase.co`                             | Variable pública GitHub comprobada; secretos/consola Supabase no inspeccionados.                                                                                              |
| Supabase Production | `rujwxzsyrqibefuhdgjd.supabase.co`                             | Variable pública GitHub comprobada; migraciones aplicadas informadas por el usuario, no se repitieron.                                                                        |
| Render antiguo      | Servicio `srv-dbkbrgu7bikc739qeokg`, `turnosmart-backend-demo` | Tercer servicio; Auto-Deploy genera estados GitHub antiguos y falla al validar `EXPECTED_DEV_SUPABASE`. No es el backend Dev vigente.                                         |

Los SHA y estados son una fotografía de la auditoría, no valores que deban fijarse
permanentemente en configuración. `/ready` acredita conectividad, no una auditoría
integral de Auth, esquema, correo o datos.

## Causas y evidencia

1. **Preview:** [run 45911653846, job 140221245638](https://github.com/natashacadabon/TurnoSmart/actions/runs/45911653846/job/140221245638).
   El GET del proyecto funciona; el GET posterior del equipo devuelve 403.
   Fue una regresión del preflight anterior. Consultar el equipo/usuario no es
   necesario para comprobar el proyecto y su cuenta, y exige acceso adicional.
2. **Production:** [run 45870572139, job 140089781077](https://github.com/natashacadabon/TurnoSmart/actions/runs/45870572139/job/140089781077).
   Build, upload, bundle y backend superaron sus controles; CLI 65.9.0 falla en
   `promote` con `User not found (404)`. Su distribución real consulta identidad
   personal y equipo antes de promover, incluso con `--scope` (ID y slug admitidos).
   El token que subió el artefacto es el mismo secret del environment usado al
   promover. No se leyó su valor ni se verificó su emisor. La dependencia de
   identidad de la CLI está confirmada; el permiso efectivo de promoción REST
   sigue pendiente de la próxima publicación autorizada.
3. **Dispatch incorrecto:** [run 45911664977](https://github.com/natashacadabon/TurnoSmart/actions/runs/45911664977).
   Se ejecutó desde Dev para Render, con Hobby sin confirmar. Ese dispatch es
   Production: debe bloquearse desde Dev. Un re-run conserva esos inputs.
4. **Estado Render antiguo:** deployment GitHub `8094688796`, productor `render`,
   environment `dev - turnosmart-backend-demo`, enlaza al servicio antiguo.
   [Log exacto de Render](https://dashboard.render.com/web/srv-dbkbrgu7bikc739qeokg/deploys/dep-dc48tfbbc2fs739g81n0):
   falla `EXPECTED_DEV_SUPABASE`. Deployment histórico `8089176871` fue exitoso;
   no prueba que ese servicio sea el Dev que debe usarse hoy.
5. **Estados Vercel engañosos:** deployment `8097994687` figura success, pero
   corresponde a cleanup, no a publicación. `8098016610` es el fallo real de
   Preview en settings. No tenían URL de frontend. Los estados Production
   `8092579620`, `8092489451` y `8092369223` son fallos de GitHub Actions.

Environment es el conjunto de políticas y secretos; Deployment es una publicación
registrada; Deployment Status es su estado sucesivo; Environment URL es su enlace.
Cambiar workflows sólo corrige registros futuros. No se alteró ni borró historial.

## Correcciones en el repositorio

- `vercel-access` comprueba proyecto y `accountId` mediante GET con `teamId`, sin
  consultar `/teams` o `/user`. Conserva errores sanitizados y fallo cerrado.
- Se reemplaza sólo la invocación de promoción CLI por la misma operación que usa
  CLI 65.9.0: `POST /v10/projects/{projectId}/promote/{deploymentId}` con `teamId`
  y cuerpo `{}`. Sin otro proveedor, dependencia ni ampliación de permisos.
- Antes del POST se exigen Main, target Production READY, proyecto/equipo, URL
  inmutable y metadata SHA completa. Nunca se
  convierte Preview a Production. Se conserva CI, revisión vigente, backend/SHA,
  bundle publicado y bypass acotado al artefacto.
- La promoción no termina en HTTP 202: espera un job nuevo `promote`, del candidato,
  `succeeded`, y vuelve a leer el deployment: identidad/SHA, READY, `aliasAssigned`,
  ausencia de `aliasError` y aliases válidos no vacíos. Sólo consulta proyecto y
  deployment, sin exigir permisos extra de dominios. Rechaza fallos, sustitución,
  estado antiguo y rolling release. El POST no se reintenta ante timeout.
- Settings y cleanup conservan environment con `deployment: false`; sólo los
  publicadores generan registros con URL real. No se cambian permisos ni políticas.
- Preflight explica primero la rama incorrecta; Hobby continúa siendo explícito
  y false por defecto. No se habilita Azure frontend.
- Se corrigen las referencias operativas antiguas en `.env.example`, Dockerfile
  de verificación y default E2E. La fixture de public-env usa `render.example.com`.
- `render.yaml` identifica `TurnoSmart`, servicio Dev vigente; advierte que no debe
  sincronizarse como Blueprint sin comprobar su asociación. No mueve recursos.
- Se actualizan regresiones y documentación, sin reescribir los cuatro workflows.

## Matriz de ejecución y seguridad

| Flujo                          | Fuente / permisos                                                               | Publicación y controles                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                       | Push/PR a Dev/Main; `contents: read`; Node 22                                   | Quality Checks obligatorio; no publica. Cancela CI obsoleto por ref.                                                                                                                                                                |
| `frontend-preview.yml`         | `workflow_run` de CI; scripts del SHA confiable de Dev                          | Dev automático y PR internas `feat/**` elegibles. Rechaza forks, Dependabot, `.github/` modificado y SHA obsoleto. Build de PR sin secretos; settings públicos saneados; alias estable y lock por destino.                          |
| `frontend-preview-cleanup.yml` | `pull_request_target: closed`, filtro de bases Dev/Main; contexto confiable Dev | Verifica PR cerrada, metadata, proyecto, aliases y target antes de borrar sólo Preview de esa PR. Comparte lock con publicación. No crea deployment.                                                                                |
| `frontend-deploy.yml`          | Sólo `workflow_dispatch`; CI por push del SHA; Main para Render                 | Environment Production exclusivo Main. Checkpoint Azure desde Dev usa Preview. Concurrency independiente; no se cancela una promoción en curso. Upload `--prod --skip-domain`; promoción después de bundle, health/readiness y SHA. |

La documentación GitHub vigente asigna `workflow_run` y `pull_request_target` al
contexto de default branch: se conserva **Dev** y el guard existente. Las políticas
Preview permiten Dev, `feat/**`, `refs/pull/**/merge`; Production sólo Main. No se
amplió a todas las ramas. Las PR que cambian workflows se prueban en CI y no
ejecutan sus scripts nuevos con secretos antes de integrar en Dev.

La deduplicación, alias Dev, cola de mutaciones y cleanup se conservan. No se
conecta Vercel Git, porque duplicaría el publicador GitHub actual.

## Configuración externa: qué cambiar y qué conservar

Orden: revisar el servicio antiguo, integrar la PR en Dev, verificar Dev, integrar
Dev→Main con merge commit, preparar el backend del SHA Main y recién entonces
autorizar el dispatch Production. No repetir migraciones ya aplicadas.

| Dashboard / campo                                                                    | Detectado / valor esperado                                                    | Acción y redeploy                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Render → `turnosmart-backend-demo` → Settings → Build & Deploy → Auto-Deploy         | Auto-Deploy activo; recurso antiguo `srv-dbkbrgu7bikc739qeokg`                | **Pendiente de autorización del usuario:** si confirma que está obsoleto, poner Off sólo en ese servicio. No borrar servicio ni tocar `TurnoSmart` o Production. No requiere redeploy; evita nuevos estados antiguos.                                  |
| GitHub → Settings → Secrets and variables → Actions → Variables                      | `VERCEL_PRODUCTION_BRANCH=main`; cuatro `EXPECTED_*` correctas                | **Sin cambios**: ya comprobadas. Dev API `https://turnosmart.onrender.com`; Prod API `https://turnosmart-backend-prod.onrender.com`; Supabase según inventario.                                                                                        |
| GitHub → Environments                                                                | Preview permite Dev; Production sólo Main; IDs coinciden                      | **Sin cambios**. Secret VERCEL_TOKEN se resuelve en cada environment, nunca desde PR. Valores de secretos no inspeccionados.                                                                                                                           |
| GitHub → Settings → General → Default branch / merge                                 | Default Dev; merge commits habilitados; Quality Checks requerido              | Conservar. Integrar esta PR y sincronizaciones entre ramas permanentes con **Create a merge commit**, no squash/rebase. Ver control Render Production previo.                                                                                          |
| Render → `TurnoSmart` (`srv-dbkk0k8u01pc73dgua40`) → Settings → Deploy → Auto-Deploy | **On Commit**; difiere de `checksPass` en `render.yaml`                       | Cambiar a **After CI Checks Pass** para conservar Dev automático y exigir CI antes de publicar. No ponerlo en Off ni crear otro servicio. No requiere redeploy.                                                                                        |
| Render → `turnosmart-backend-prod` → Settings → Deploy → Auto-Deploy                 | **On Commit**, rama Main, sin filtros de build                                | **Antes de integrar en Main**, poner **Off** para exigir publicación autorizada. No cambia el servicio activo ni requiere redeploy. No se modificó automáticamente. On Commit permite desplegar antes de CI.                                           |
| GitHub → About → Website                                                             | `https://turno-smart-neon.vercel.app`                                         | Enlace Production esperado; actualmente 404. No sustituir por backend antiguo. No necesita cambio; se habilitará al promover.                                                                                                                          |
| Vercel → `natcads-projects/turno-smart` → Settings → Domains                         | `turno-smart-neon.vercel.app`, Production, No Deployment                      | Conservar dominio/proyecto. La publicación controlada lo asignará. No crear infraestructura.                                                                                                                                                           |
| Vercel → Deployment Protection → Require Log In                                      | Standard Protection habilitada                                                | Conservar. Dev anónimo redirige a SSO. No desactivar protección ni generar otro bypass. Si verificación del artefacto falla por protección, comprobar el secret existente `VERCEL_AUTOMATION_BYPASS` sólo en `vercel-production`.                      |
| Vercel → Environment Variables                                                       | Valores reales no inspeccionados                                              | No pedir cambios sin evidencia. `pull/prepare` comprueba exactamente las URLs esperadas para cada target antes de build. Si falla, corregir sólo el scope señalado; requiere nuevo build.                                                              |
| Render actual / Supabase → Environment, Vault, Cron, Auth URL Configuration          | DSN, CORS, actions URL, cron secret, Vault/Cron y redirects no inspeccionados | Sin cambios automáticos. Backends sanos permiten inferir que pasaron validación de arranque, no certificar toda la configuración. Verificar aisladamente si una prueba funcional falla; no reutilizar secretos entre proyectos ni repetir migraciones. |

No hay cambio manual de variables GitHub demostrado como necesario. Los IDs
públicos existentes se reutilizan; no hace falta slug ni nuevo token. La lectura
del proyecto no garantiza permiso para promover. Si REST rechaza el POST, conservar
su HTTP sanitizado, detenerse e investigar acceso al proyecto; no ampliar permisos
automáticamente ni declarar Production resuelto.

## Publicación Production después de aprobar e integrar

1. Revisar y aprobar la PR de corrección hacia Dev. **Create a merge commit**
   preserva los padres de Main ya incorporados; no squash. Esperar Quality Checks.
2. Confirmar el nuevo Dev Preview, su alias y backend Dev. Un resumen omitido no
   acredita publicación. No reejecutar el dispatch Production desde Dev.
3. Abrir una PR Dev→Main; esperar Quality Checks y revisiones. Integrar con merge
   commit. No ejecutar despliegue hasta autorización explícita de Production.
4. Registrar el SHA completo de Main. El backend Production debe ejecutar **ese
   mismo SHA**, no sólo los mismos archivos. Si está en Off o el filtro excluye
   cambios CI/frontend, autorizar en Render el deploy de ese commit, usando el
   servicio Production existente. Se comprobó On Commit durante la auditoría:
   ponerlo en Off **antes del paso 3**. No habilitarlo sólo para este paso.
5. Comprobar `/health` (servicio `turnosmart-backend`, versión SHA candidato) y
   `/ready` (`ready`). No migrar de nuevo por una diferencia de SHA.
6. GitHub → Actions → **Frontend deploy** → Run workflow: rama **main**,
   `target=render`, `frontend_target=vercel`, confirmar Hobby sólo si corresponde.
   Dejar URLs checkpoint vacías. Crear una ejecución nueva; no re-run de Dev.
7. Deben aprobarse preflight/CI, proyecto, pull Production, build/bundle, revisión
   vigente, upload sin dominios, verificación publicada, backend/SHA, última
   revisión y promoción confirmada. No promover manualmente desde dashboard.
8. Abrir https://turno-smart-neon.vercel.app/login. Debe servir la aplicación,
   no 404/SSO inesperado. Revisar GitHub deployment y resumen con ese dominio.
   Comprobar requests de navegador al backend Production y Supabase Production;
   login, navegación y un recorrido autorizado sin tocar datos Dev.
9. Si hay timeout tras POST, consultar job/dominios en Vercel antes de otro intento.
   Un run fallido puede haber dejado un artefacto staged; no equivale a publicación.

## Evidencia de validación y estado

Validaciones locales ejecutadas con **Node 22.23.4 / npm 10.9.9**, sin publicar:

| Comando / control                               | Resultado                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`                          | Aprobado en todo el repositorio.                                                                                                                  |
| `npm run lint`                                  | Aprobado.                                                                                                                                         |
| `npm run typecheck`                             | Aprobado en frontend/backend/shared; incluye build shared.                                                                                        |
| `npm test`                                      | Aprobado: 14 instalación, 16 backup (incluidos wrappers PowerShell), 4 Docker con dobles y 242 tests backend en 15 archivos.                      |
| `npm run test:config --workspace=apps/frontend` | 62 aprobados, ninguno omitido. Acceso sin permisos globales, promoción, polling, errores HTTP, no reintento, SHA, aislamiento, aliases y cleanup. |
| `npm run build --workspace=apps/frontend`       | Aprobado, Next 16.4.5; variables públicas ficticias equivalentes a CI. Sin publicación.                                                           |
| `npm run build --workspace=apps/backend`        | Aprobado; Prisma Client existente al día, sin regeneración necesaria.                                                                             |
| Parse YAML con `js-yaml` existente              | CI, deploy, preview, cleanup y `render.yaml`: aprobados. No certifica políticas remotas; se inspeccionaron por separado.                          |
| `git diff --check`                              | Aprobado. Revisión independiente sin bloqueantes tras corregir las observaciones.                                                                 |
| GET `/health` y `/ready` de ambos backends      | Cuatro HTTP 200; versiones del inventario.                                                                                                        |

No se ejecutó una instalación limpia raíz (`npm ci`), porque no cambian dependencias
ni lockfile; los tests de instalación sí ejecutan instalaciones de sus fixtures.
No se ejecutaron E2E de negocio, promoción real ni smoke funcional cloud: no se
modifica UX/negocio y la publicación Production requiere autorización. Las pruebas
del proveedor utilizan dobles: **no acreditan una promoción remota**.

Archivos modificados: los tres workflows de frontend; `deploy-config.mjs` y sus
tests, `preview-cleanup.test.mjs`, `public-env.test.mjs`, `.env.example` y el default
de `e2e-deploy/public-build.spec.ts`; `render.yaml`, `infra/vercel/Dockerfile.check`,
`infra/vercel/README.md`, `infra/render/README.md`, `docs/operations.md` y este informe.
`ci.yml` fue auditado y validado, sin modificación. No se agregaron dependencias.

El commit sigue Conventional Commits en español. La rama se publica mediante PR
hacia Dev, sin merge remoto; el enlace y SHA definitivos se entregan en la respuesta.

Estado auditado: backend Dev **operativo**, backend Production **operativo**,
frontend Dev **vigente pero protegido**, frontend Production **sin publicación**.
**NO-GO para declarar Production listo** hasta completar el dispatch autorizado y
la verificación funcional. No se alteraron servicios remotos, secretos, dominios,
políticas, datos, migraciones ni fallos históricos.

## Fuentes primarias

- [Promoción Vercel](https://vercel.com/docs/deployments/promoting-a-deployment) y
  [CLI promote](https://vercel.com/docs/cli/promote). Además se inspeccionaron
  `getProjectByDeployment`, `requestPromote` y `promoteStatus` en el paquete
  distribuido `vercel@65.9.0`, sin cambiar su versión.
- [GitHub: environments sin deployment](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/deploy-to-environment).
- [GitHub: eventos y contexto confiable](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
- [Render: Blueprint y asociación de servicios](https://render.com/docs/blueprint-spec).
