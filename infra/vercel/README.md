# Frontend de demo — Vercel Hobby (preparado, sin desplegar)

## Elegibilidad y alcance

Segun [Hobby](https://vercel.com/docs/plans/hobby) y las
[reglas de uso](https://vercel.com/docs/limits/fair-use-guidelines), Hobby se limita
a uso personal no comercial. La demo academica declarada es compatible en principio
si no hay monetizacion, cliente pago ni trabajo remunerado destinado al proyecto.
El titular debe confirmar esas condiciones y las de su cuenta antes de publicar;
si no se cumplen, detenerse y acordar destino, sin upgrade ni Azure automaticos.
Usar un operador/titular Hobby, dominio incluido *.vercel.app y respetar cuotas;
no activar add-ons, equipo Pro, dominios comprados ni servicios de almacenamiento.

## Proyecto y monorepo

Preparar/configurar **manualmente** el proyecto del titular, sin publicar ahora:

| Setting Vercel                              | Valor                                                                |
| ------------------------------------------- | -------------------------------------------------------------------- |
| Framework                                   | Next.js                                                              |
| Root Directory                              | apps/frontend                                                        |
| Include source files outside Root Directory | Activado (packages/shared y lock raiz)                               |
| Node.js                                     | 22.x (tambien declarado en frontend/package.json)                    |
| Install Command                             | vercel.json: cd ../.. && npm ci --include=dev                        |
| Build Command                               | vercel.json: compilar shared desde raiz y npm run build del frontend |
| Output Directory                            | Default de Next.js (.next), sin standalone/static export             |
| Git deployment                              | Deshabilitado en vercel.json; preferir proyecto sin Git conectado    |

El lock unico se instala desde raiz; shared exporta dist y se compila primero.
`--include=dev` conserva TypeScript y herramientas de Next/shared aun con
NODE_ENV=production u omit=dev. No configurar NPM_CONFIG_IGNORE_SCRIPTS ni
deshabilitar lifecycle scripts. El prepare raiz usa el
[installer recomendado por Husky](https://typicode.github.io/husky/how-to.html#ci-server-and-docker):
omite CI, produccion, Vercel/Render o HUSKY=0 antes de importar Husky, aunque el
paquete no este instalado. En desarrollo local la ausencia de Husky es un error
explicito que pide `npm ci --include=dev`; no se oculta una instalacion rota.
Los hooks locales siguen inicializandose al instalar con devDependencies. Usar
Node 22.23.4 (`.nvmrc`), que tambien cumple el minimo de lint-staged.
No se construye/despliega el backend ni se ejecutan migraciones; los lifecycle
de dependencias permanecen habilitados.
Next detecta la raiz del workspace mediante package-lock.json, sin alias nuevos.
[Referencia monorepos](https://vercel.com/docs/monorepos/monorepo-faq).

## Si el log muestra Node 26 o prepare: husky

Los cuatro workspaces declaran `engines.node: "22.x"`. Vercel usa engines para
[seleccionar Node](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions);
no admite un campo nodeVersion en vercel.json. En Settings → Build and Deployment,
seleccionar Node.js 22.x y Root Directory `apps/frontend`, habilitando archivos
fuera de esa carpeta. Conservar el Install Command y Build Command del vercel.json
versionado; retirar overrides antiguos con `npm install` o `husky`.

Antes de un despliegue manual autorizado, comprobar el SHA del deployment y que
esa revision contiene `prepare: node .husky/install.mjs` y este vercel.json. Un
Redeploy de un deployment viejo reutiliza su revision: no toma cambios locales ni
automaticamente otro commit. Para la nueva revision, reconstruir sin cache viejo
al cambiar Node o la instalacion. El log esperado muestra Node 22.x,
`npm ci --include=dev` y `node .husky/install.mjs`, nunca `sh -c husky`.
No se modifican Settings de la cuenta ni se despliega desde estas comprobaciones.

## Variables publicas durante el build

En Vercel → Settings → Environment Variables, configurar **Production** y
**Preview** por separado antes del build. Preview usa el Render Dev compartido
y Supabase Dev. Production usa exclusivamente el backend y Supabase de Production.
Si solo existe el servicio demo, reservarlo para Dev y dejar pendiente la
publicacion de Production hasta contar con un entorno separado.

| Variable                      | Valor                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| NEXT_PUBLIC_USE_AZURE         | false u omitida en ambos entornos. Azure se selecciona en el dispatch de checkpoint |
| NEXT_PUBLIC_API_URL_RENDER    | Origen HTTPS de Render, sin /api, query ni credenciales                             |
| NEXT_PUBLIC_API_URL_AZURE     | Origen HTTPS de Azure, tambien obligatorio aunque este apagado                      |
| NEXT_PUBLIC_SUPABASE_URL      | Origen HTTPS del mismo proyecto Supabase que utiliza el backend                     |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Publishable sb_publishable_* o JWT legacy con role anon de ese proyecto             |

Todo NEXT_PUBLIC_* queda visible en el navegador. **Nunca** configurar service_role,
sb_secret_*, DATABASE_URL, DIRECT_URL, claves Gemini o credenciales Azure en este
proyecto, ni siquiera como variables privadas. No copiar .env del backend.
La [clave publica](https://supabase.com/docs/guides/api/api-keys) no reemplaza RLS,
validacion de tokens ni aislamiento del backend.

prebuild usa el cargador de entorno de Next con su precedencia y falla ante
variables ausentes, URLs locales/no HTTPS/no origen o claves privilegiadas. El
decode del JWT solo previene una mala configuracion; no valida firmas. El cliente
no usa la variable antigua NEXT_PUBLIC_API_URL ni fallback a localhost. verify:public-build comprueba los
valores esperados en JS y el origen registrado por postbuild, sin publicar claves en metadata.
El selector vive en src/lib/backend-url.mjs y lo reutiliza el cliente HTTP. No hay
fallback automatico: un fallo se informa sin llamar al proveedor inactivo. Ambas
URLs se validan solo por formato/seguridad, nunca por disponibilidad de red.
Cambiar cualquier NEXT_PUBLIC requiere **rebuild y nuevo deploy**; cambiar solo
el entorno de runtime no reemplaza valores ya incluidos en el bundle.

## Auth y CORS con el backend seleccionado

El flujo implementado es signInWithPassword, sesion local/renovacion y token Bearer
a Express. Redirects internos: sin sesion → /login; con sesion sin negocio →
/onboarding; login con negocio → /customers. No hay OAuth, magic link, recovery ni
ruta auth/callback implementados; no agregar un callback ficticio a Supabase.

Antes de la demo, el operador debe configurar el dominio estable de Vercel en el
Supabase existente: Authentication → URL Configuration → Site URL = origen HTTPS
publicado; Redirect URLs exactas para ese origen y /login si se utilizan enlaces
de Auth. El login por password no necesita redirectTo. Registrar el valor anterior
para restaurarlo al terminar si el proyecto se comparte. Evitar wildcards amplios
en produccion. [Referencia redirects](https://supabase.com/docs/guides/auth/redirect-urls).

En cada backend existente que vaya a usarse (Render/Azure), CORS_ORIGIN debe contener el **origen exacto** del
frontend (ej. https://turnosmart-demo.vercel.app), sin slash final ni rutas; varios
origenes se separan por coma. No usar * ni *.vercel.app. Authorization/Content-Type
y OPTIONS ya estan admitidos; no hacen falta cookies cross-site ni credentials.
Cada Preview utiliza Render y Supabase de Dev. Para login, preferir un alias
estable dedicado a QA si ya existe y esta asignado al deployment correcto.
Registrar ese origen exacto solo en el CORS_ORIGIN de Render Dev. Si no hay
alias, autorizar temporalmente la URL del resumen del run y retirarla al
terminar. Usar Save and deploy para aplicar la variable al build existente.
La URL inmutable cambia por deployment y requiere autorizacion propia. Hasta
entonces se puede revisar la UI publica. Usar cuentas y datos de prueba en Dev.

## Activacion de CD y rollback

1. Confirmar Hobby y el proyecto existente. Usar **GitHub Actions como unico
   publicador** y desconectar Git en Vercel. Si el proyecto aun tiene Git conectado,
   alinear Production Branch con la rama del dispatch. El `vercel.json`
   mantiene los despliegues Git deshabilitados. Configurar los dos scopes publicos
   de la tabla y mantener Node 22.
2. En GitHub crear los environments `vercel-production` y `vercel-preview`.
   Restringir Production a `main` al completar la transicion. Para Preview
   permitir pushes `feat/**` de colaboradores de confianza, los PR internos
   durante el piloto y `dev` para checkpoints. En `vercel-preview` definir
   `EXPECTED_DEV_API` y `EXPECTED_DEV_SUPABASE` con los dos origenes Dev exactos
   sin slash final. Los Previews de Render fallan si el scope Preview apunta a
   otros origenes. Verificar tambien que `DATABASE_URL` de Render Dev apunte
   a la base Dev. La comprobacion del bundle no puede inspeccionar esa conexion.
   Guardar `VERCEL_TOKEN` como secret de cada environment, con alcance al equipo
   Hobby correspondiente. En ambos configurar el secret opcional
   `VERCEL_AUTOMATION_BYPASS` si se protege el acceso a URLs de deploy. La
   automatizacion solo envia ese header a la URL inmutable HTTPS de Vercel.
   Configurar `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` como variables GitHub
   del proyecto existente, iguales para ambos scopes. Los valores
   `NEXT_PUBLIC_*` se mantienen en Vercel, no se duplican en GitHub.
3. Proteger `dev` y `main` y requerir `Quality Checks`. En el modo feature,
   los PR siguen verificando la revision de merge con el build ficticio.
   Los PR de forks y Dependabot hacen CI con valores ficticios.
   Restringir el permiso de escritura a colaboradores de confianza: los PR
   internos pueden editar el workflow que usa el token Preview. Las reglas y
   secretos de environments requieren un plan compatible con la visibilidad del
   repo. Ver [GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
4. Confirmar que el proyecto existente ya tiene un deployment Production READY.
   Mantener el dispatch existente disponible durante el piloto. Su rama por
   defecto es `dev` por compatibilidad. Cuando Production tenga backend y DB
   separados, fijar `VERCEL_PRODUCTION_BRANCH=main`, alinear Vercel y restringir
   el environment de GitHub a `main`. El dispatch requiere CI de push exitosa
   para el SHA exacto. Si falta el deployment inicial, aplicar primero esa
   configuracion y hacer el bootstrap manual desde `main`.
5. Habilitar `VERCEL_CD_ENABLED=true` y `VERCEL_FEATURE_PREVIEWS=true` como
   variables del repositorio para el piloto. Verificar un push de feature con
   y sin PR abierto, un cambio solo backend en una rama sin delta de frontend,
   un fallo de CI y dos pushes consecutivos. Revisar el resumen de Actions y
   Deployments en Vercel para confirmar que solo Actions publica.

| Evento                  | CI                            | Publicacion con modo feature activo                                   |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------- |
| Push a `feat/**`        | Quality Checks                | Preview si hay delta de frontend respecto al ancestro comun con `dev` |
| PR hacia `dev` o `main` | Quality Checks sobre el merge | Sin publicacion                                                       |
| Push a `dev`            | Quality Checks                | Render Dev nativo si coincide su filtro y pasa CI                     |
| Push a `main`           | Quality Checks                | Production queda disponible para dispatch manual                      |

El filtro de frontend incluye `apps/frontend/**`, `packages/shared/**`,
workflows y archivos de build de raiz. Es acumulado respecto de `dev`:
una rama con cambios frontend sigue generando Preview aunque su ultimo commit
solo cambie backend. Asi un push posterior puede recuperar un Preview fallido.
Las corridas obsoletas se cancelan por ref y se verifica el SHA antes de subir.
Los jobs sin publicacion conservan el build de CI con valores ficticios.

`pull` toma el scope correspondiente. El workflow comprueba el proyecto,
mantiene los valores publicos, descarta el resto del cache y usa los comandos
versionados de Node 22/workspaces. La CLI instala y compila una vez; `--prebuilt`
sube ese artefacto. Production se sube con `--skip-domain`, se verifica /login y
los hashes del JavaScript servido, y solo entonces se promueve. Preview exige
una Production lista para evitar la promocion implicita del primer despliegue.

Para un checkpoint con la API Azure ya disponible, usar el mismo dispatch
desde `dev` con `target=azure` e ingresar ambas URLs HTTPS. El build usa una
Preview con esas URLs y el Supabase del scope Preview. `frontend_target=azure`
sigue bloqueado. Los recursos de Azure se administran con el procedimiento B07.

Para volver al modo anterior de Preview por PR interno a `dev`, desactivar
`VERCEL_FEATURE_PREVIEWS` y cancelar los runs en curso. Para pausar toda
publicacion automatica en Vercel, desactivar `VERCEL_CD_ENABLED`. Si se necesita
restaurar Production, cancelar los runs en curso y
usar Instant Rollback en el Dashboard sobre la Production inmediatamente
anterior, que es la admitida en Hobby. Confirmar el dominio y /login, corregir o revertir el commit en la rama de Production
y republicar una vez validado antes de reactivar CD. Preview puede eliminarse
desde Deployments. Revisar [cuotas Hobby](https://vercel.com/docs/plans/hobby)
y [retencion](https://vercel.com/changelog/hobby-projects-now-retain-fewer-deployments-to-free-up-storage).

Validar desde navegador publicado: /demo y /login; /customers sin sesion redirige;
login, onboarding solo si corresponde, clientes, recarga y logout. DevTools Network
debe mostrar Auth a Supabase y API solo al backend elegido, sin localhost ni mixed content.
OPTIONS a /api/customers con Origin Vercel y Access-Control-Request-Headers:
authorization,content-type debe responder 204 y Access-Control-Allow-Origin exacto;
un origen ajeno debe ser 403. /health y /ready del backend elegido deben dar 200 antes de operar datos.

## Pruebas locales aisladas (sin cuenta ni cambios en Cloud)

```powershell
npm run test:config --workspace=apps/frontend
docker build -f infra/vercel/Dockerfile.check -t turnosmart-vercel-check .
docker run -d --name turnosmart-vercel-check -p 127.0.0.1:43128:43128 -e NEXT_PUBLIC_USE_AZURE=true -e NEXT_PUBLIC_API_URL_RENDER=https://runtime-ignored.invalid turnosmart-vercel-check
npm run test:deploy --workspace=apps/frontend
docker rm -f turnosmart-vercel-check
npm run typecheck
npm run lint
```

El Dockerfile usa Node 22 Linux, allowlist sin .env y URLs/clave ficticias. Compila
shared/Next, prueba configuracion y verifica el bundle sin tocar el dev server.
Playwright usa Chrome instalado (E2E_BROWSER_CHANNEL=msedge como alternativa),
intercepta Auth/API y bloquea requests externos inesperados. Prueba que cambiar la
seleccion en runtime no altera el build. Para probar Azure, construir con
`--build-arg USE_AZURE=true` y ejecutar Playwright con
`E2E_API_URL=https://turnosmart-api.azurewebsites.net`. Ambos modos comprueban
que una falla no dispara fallback. Cambiar el flag en Vercel requiere reconstruir. No reemplaza el E2E real con Supabase/cuenta
provisionada (`test:e2e`), que queda para la ventana con configuracion real.

## Eliminacion y costo

Al cerrar, eliminar el proyecto de demo desde Vercel Settings → General → Delete
Project, verificando que desaparecen deployments y aliases de esa demo (borrar
solo el proyecto propio identificado). Desconectar Git si se hubiera conectado,
revocar el token de despliegue temporal si era exclusivo y quitar las variables
GitHub de ese proyecto. Retirar solo sus origenes de CORS_ORIGIN/Redirect URLs y
restaurar Site URL previa; no borrar Supabase ni datos compartidos.
Quitar .vercel/ local solo si ya no se usara ese vinculo; confirmar que las URLs
de demo dejan de servir. Registrar uso/cuotas y cierre en docs/costs.md.
Hobby no habilita gasto pago automatico; si no alcanza o deja de ser elegible,
detener la demo y revisar alternativas con el equipo. La limpieza del backend
Azure sigue el procedimiento B07, por separado.
