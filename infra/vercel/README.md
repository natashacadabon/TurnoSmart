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
| Install Command                             | vercel.json: cd ../.. && HUSKY=0 npm ci --ignore-scripts             |
| Build Command                               | vercel.json: compilar shared desde raiz y npm run build del frontend |
| Output Directory                            | Default de Next.js (.next), sin standalone/static export             |
| Git deployment                              | Deshabilitado en vercel.json; preferir proyecto sin Git conectado    |

El lock unico se instala desde raiz; shared exporta dist y se compila primero.
No se construye/despliega el backend, no se genera Prisma ni se ejecutan migraciones.
Next detecta la raiz del workspace mediante package-lock.json, sin alias nuevos.
[Referencia monorepos](https://vercel.com/docs/monorepos/monorepo-faq).

## Variables publicas durante el build

En Vercel → Settings → Environment Variables, configurar **Production** (y solo
si se necesita, Preview con valores propios) antes del build:

| Variable                      | Valor                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| NEXT_PUBLIC_API_URL           | Origen HTTPS del backend Azure existente, sin /api, query ni credenciales |
| NEXT_PUBLIC_SUPABASE_URL      | Origen HTTPS del mismo proyecto Supabase que utiliza el backend           |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Publishable sb_publishable_* o JWT legacy con role anon de ese proyecto   |

Todo NEXT_PUBLIC_* queda visible en el navegador. **Nunca** configurar service_role,
sb_secret_*, DATABASE_URL, DIRECT_URL, claves Gemini o credenciales Azure en este
proyecto, ni siquiera como variables privadas. No copiar .env del backend.
La [clave publica](https://supabase.com/docs/guides/api/api-keys) no reemplaza RLS,
validacion de tokens ni aislamiento del backend.

prebuild usa el cargador de entorno de Next con su precedencia y falla ante
variables ausentes, URLs locales/no HTTPS/no origen o claves privilegiadas. El
decode del JWT solo previene una mala configuracion; no valida firmas. El cliente
solo tiene fallback localhost en development. verify:public-build comprueba los
valores esperados en JS del navegador y ausencia del fallback de API local.
Cambiar cualquier NEXT_PUBLIC requiere **rebuild y nuevo deploy**; cambiar solo
el entorno de runtime no reemplaza valores ya incluidos en el bundle.

## Auth y CORS con Azure

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

En el backend Azure existente, CORS_ORIGIN debe contener el **origen exacto** del
frontend (ej. https://turnosmart-demo.vercel.app), sin slash final ni rutas; varios
origenes se separan por coma. No usar * ni *.vercel.app. Authorization/Content-Type
y OPTIONS ya estan admitidos; no hacen falta cookies cross-site ni credentials.
Previews con otro origen requieren alta explicita y limpieza posterior: preferir
un dominio estable para la demo. No crear otra Web App ni recursos Azure.

## Publicacion manual futura y validacion

No ejecutar hasta autorizar la ventana. CLI desde la **raiz del monorepo**:
`npx vercel link` (proyecto existente correcto), `npx vercel pull --environment=production`,
`npx vercel build --prod`, verificar bundle y `npx vercel deploy --prebuilt --prod`.
Antes de `npm run verify:public-build --workspace=apps/frontend`, exportar al
proceso las tres NEXT_PUBLIC esperadas, coincidentes con Production. vercel pull
guarda sus valores en .vercel/.env.production.local, pero el proceso de build no
los exporta al shell; el verificador no debe usar un .env.local de desarrollo.
La vinculacion vive en .vercel/ de la raiz, ignorada por Git; no vincular una segunda
copia desde apps/frontend. CLI local no implica publicacion hasta deploy.

El workflow existente Frontend deploy (manual) es equivalente: target vercel,
api_url HTTPS y hobby_eligible confirmado. Requiere VERCEL_TOKEN como secret,
VERCEL_ORG_ID/VERCEL_PROJECT_ID del link **raiz**, SUPABASE_URL/SUPABASE_ANON_KEY
publicos en GitHub Variables, coincidentes con Vercel. El chequeo posterior al
build aborta si los valores efectivos difieren; no publicar un bundle antiguo.
No activar pushes automaticos ni usar el target Azure legacy para esta demo.

Validar desde navegador publicado: /demo y /login; /customers sin sesion redirige;
login, onboarding solo si corresponde, clientes, recarga y logout. DevTools Network
debe mostrar Auth a Supabase y API al backend Azure, sin localhost ni mixed content.
OPTIONS a /api/customers con Origin Vercel y Access-Control-Request-Headers:
authorization,content-type debe responder 204 y Access-Control-Allow-Origin exacto;
un origen ajeno debe ser 403. /health y /ready de Azure deben dar 200 antes de demo.

## Pruebas locales aisladas (sin cuenta ni cambios en Cloud)

```powershell
npm run test:config --workspace=apps/frontend
docker build -f infra/vercel/Dockerfile.check -t turnosmart-vercel-check .
docker run -d --name turnosmart-vercel-check -p 127.0.0.1:43128:43128 -e NEXT_PUBLIC_API_URL=https://runtime-ignored.invalid turnosmart-vercel-check
npm run test:deploy --workspace=apps/frontend
docker rm -f turnosmart-vercel-check
npm run typecheck
npm run lint
```

El Dockerfile usa Node 22 Linux, allowlist sin .env y URLs/clave ficticias. Compila
shared/Next, prueba configuracion y verifica el bundle sin tocar el dev server.
Playwright usa Chrome instalado (E2E_BROWSER_CHANNEL=msedge como alternativa),
intercepta Auth/API y bloquea requests externos inesperados. Prueba que cambiar la
URL en runtime no altera el build. No reemplaza el E2E real con Supabase/cuenta
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
