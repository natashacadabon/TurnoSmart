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

En Vercel → Settings → Environment Variables, configurar **Production** (y solo
si se necesita, Preview con valores propios) antes del build:

| Variable                      | Valor                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| NEXT_PUBLIC_USE_AZURE         | false (predeterminado si se omite): Render; true: Azure. Strings exactos, sin espacios |
| NEXT_PUBLIC_API_URL_RENDER    | Origen HTTPS de Render, sin /api, query ni credenciales                                |
| NEXT_PUBLIC_API_URL_AZURE     | Origen HTTPS de Azure, tambien obligatorio aunque este apagado                         |
| NEXT_PUBLIC_SUPABASE_URL      | Origen HTTPS del mismo proyecto Supabase que utiliza el backend                        |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Publishable sb_publishable_* o JWT legacy con role anon de ese proyecto                |

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
Previews con otro origen requieren alta explicita y limpieza posterior: preferir
un dominio estable para la demo. No crear otra Web App ni recursos Azure.

## Publicacion manual futura y validacion

No ejecutar hasta autorizar la ventana. CLI desde la **raiz del monorepo**:
`npx vercel@65.9.0 link` (proyecto existente correcto). Exportar al proceso las cinco
variables publicas esperadas y VERCEL_TOKEN/VERCEL_ORG_ID/VERCEL_PROJECT_ID; no
copiar secretos del backend. Seguir el mismo orden del workflow:

```bash
node apps/frontend/scripts/deploy-config.mjs validate
npx vercel@65.9.0 pull --yes --environment=production
node apps/frontend/scripts/deploy-config.mjs prepare
npx vercel@65.9.0 build --prod --output .vercel/output
npm run verify:public-build --workspace=apps/frontend
node apps/frontend/scripts/deploy-config.mjs output
# Solo durante la ventana autorizada:
url=$(npx vercel@65.9.0 deploy --prebuilt --prod --yes)
DEPLOYMENT_URL="$url" node apps/frontend/scripts/deploy-config.mjs published
```

`pull` descarga configuracion remota. `prepare` verifica el proyecto y su Root
Directory, fija Node 22 y comandos del vercel.json versionado, y reemplaza las
caches de entorno de Vercel por las cinco variables publicas del proceso. Asi el
selector y las URLs de GitHub Actions prevalecen aunque Production tenga valores
viejos; no modifica Settings remotos ni archivos .env de desarrollo. No ejecutar
otro pull entre prepare y build. Nunca imprimir ni subir caches como artifacts.
La vinculacion vive en .vercel/ de la raiz, ignorada por Git; no vincular una segunda
copia desde apps/frontend. CLI local no implica publicacion hasta deploy.

El workflow existente Frontend deploy (manual) separa `target` (proveedor de API:
render/azure) de `frontend_target` (publicacion: vercel/azure). Para publicar en
Vercel usar `frontend_target=vercel`, seleccionar `target=render` o `azure`,
ingresar api_url_render y api_url_azure HTTPS y confirmar hobby_eligible.
`NEXT_PUBLIC_USE_AZURE` se deriva exclusivamente de `target`; no hay un selector
booleano adicional. Requiere VERCEL_TOKEN como secret,
VERCEL_ORG_ID/VERCEL_PROJECT_ID del link **raiz**, SUPABASE_URL/SUPABASE_ANON_KEY
publicos en GitHub Variables. Requiere el ultimo run de `ci.yml` por push, para el
SHA exacto del dispatch, completado con success (actualmente dev/main); no acepta
CI de otro SHA, solo PR, pendiente, fallida o cancelada. Ambos checkouts fijan ese SHA.
Los tests de configuracion se ejecutan antes del CLI. Se verifica .next y tambien
la copia JS de `.vercel/output` que deploy --prebuilt envia. Tras publicar, se
descarga /login de la URL inmutable y todos los chunks JS (tambien lazy) y se comparan SHA-256 contra
ese artefacto; un bundle distinto, 401/5xx, timeout o redirect falla el workflow.
Deployment Protection debe permitir el acceso publico de la demo. Una falla de
verificacion posterior no revierte automaticamente la publicacion: inspeccionar y
retirar el deployment durante la ventana autorizada. No prueba login real ni CORS.

`frontend_target=azure` falla explicitamente en preflight, incluso cuando
`target=azure` es valido para Vercel. No hay pasos de despliegue Azure ni permiso
OIDC. Solo habilitarlo tras contar con infraestructura, ZIP standalone y startup
comprobados; entonces `id-token: write` debe existir exclusivamente en su job
Azure, nunca globalmente ni en Vercel. `actions: read` solo se otorga al gate CI.
El unico trigger es workflow_dispatch; no activar pushes automaticos.

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
