# Backend Express/Prisma en Render Free

Un Web Service nativo Node 22 desde GitHub, con Supabase Cloud existente. Sin
Render Postgres, discos, frontend ni servicios pagos.
`render.yaml` en la raiz documenta el servicio; crear/sincronizar un Blueprint
inicia el primer deploy, por lo que no hacerlo hasta autorizar la ventana.

## Valores exactos en Render

En New → Web Service → Git Provider → GitHub, elegir repo/rama autorizados:

| Campo              | Valor                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------- |
| Language / Runtime | Node                                                                                   |
| Instance Type      | Free                                                                                   |
| Region             | Virginia (verificar disponibilidad en la cuenta; cerca del Supabase East US existente) |
| Root Directory     | **Vacio**, raiz del repo; no apps/backend                                              |
| Branch             | `dev`                                                                                  |
| Build Command      | `npm run build:render`                                                                 |
| Start Command      | `npm run start:render`                                                                 |
| Health Check Path  | `/health`                                                                              |
| Auto-Deploy        | After CI Checks Pass (`autoDeployTrigger: checksPass`)                                 |
| Build Filters      | Included Paths de `render.yaml`                                                        |
| Pre-Deploy Command | Vacio                                                                                  |

En el servicio existente, aplicar los settings manualmente despues de validar
la CI de `dev`. Si se usa Blueprint, revisar el plan de sincronizacion porque
aplicarlo puede iniciar un deploy. Los filtros incluyen backend, shared y
configuracion de build/lock de la raiz. Los cambios solo frontend no disparan
Render. Mantener deshabilitados Service Previews, Preview Environments, deploy
hooks, cron, keep-alive y upgrades. Render observa los checks de GitHub del
commit. Un check fallido bloquea el despliegue de Render. La publicacion de
Vercel Preview corre en ramas feature y no forma parte de ese push. El modo nativo evita tokens de Render
en GitHub. Ver [integracion con CI](https://render.com/docs/deploys#integrating-with-ci)
y [filtros](https://render.com/docs/monorepo-support#setting-build-filters).

Este servicio es Dev compartido. Confirmar que DATABASE_URL, SUPABASE_URL y
SUPABASE_ANON_KEY sean del entorno Dev antes de habilitar Previews en Vercel.
Production, si ya existe, requiere un servicio y una base separados.
Para pausar CD, elegir Auto-Deploy Off y desactivar cualquier automatizacion
externa que llame al servicio. Si se revierte un deploy desde Render, revisar
el estado de Auto-Deploy antes de reactivarlo.

Build Command expande exactamente a:

```sh
npm ci --include=dev --workspace=apps/backend --workspace=packages/shared && npm run prisma:generate --workspace=apps/backend && npm run build:shared && npm run build --workspace=apps/backend
```

Start Command expande a `npm run start --workspace=apps/backend`, que ejecuta
`node dist/index.js` desde apps/backend. No usar `npm run build` de raiz: tambien
compila frontend y exige sus variables publicas. No usar `npm install` en startup.

Se instalan desde el lock unico solo los workspaces requeridos, incluyendo las
herramientas de compilacion aun con NODE_ENV=production. Los lifecycle scripts npm
permanecen habilitados; prepare omite Husky en hosting/CI/produccion. En desarrollo
local falla claramente si faltan las devDependencies, conservando los hooks.
No configurar NPM_CONFIG_IGNORE_SCRIPTS. Se genera Prisma **explicitamente en Linux** antes de
compilar. Se conserva el cliente nativo generado y shared/dist en el monorepo.
No usar cliente generado en Windows/musl ni copiar node_modules desde una PC.
No se cambia schema ni binaryTargets. No hay migrate, db push, seed ni SQL en
build/start, preDeployCommand o initialDeployHook.

## Variables de entorno (Render → Environment)

| Variable          | Valor / uso                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| NODE_VERSION      | `22.23.4` (misma version validada; engines raiz limita a >=22 <23)                                                                |
| NODE_ENV          | `production`                                                                                                                      |
| HUSKY             | `0`                                                                                                                               |
| DATABASE_URL      | URL runtime del Supabase existente, TLS; **secreto**, no copiar a Git ni logs                                                     |
| SUPABASE_URL      | URL HTTPS del mismo proyecto Supabase que usa el frontend                                                                         |
| SUPABASE_ANON_KEY | Clave anon/publishable del mismo proyecto; no service_role                                                                        |
| CORS_ORIGIN       | Origen HTTPS Vercel exacto, p. ej. `https://turnosmart-demo.vercel.app`, sin slash final/ruta/wildcard; varios separados por coma |
| PORT              | **No fijar**: Render lo proporciona (normalmente 10000); Express ya escucha env.PORT en 0.0.0.0                                   |

DATABASE_URL/SUPABASE_URL/SUPABASE_ANON_KEY/CORS_ORIGIN son `sync: false`: se cargan
manualmente al crear el Blueprint, sin valores reales en YAML. En servicios ya
existentes, agregar/cambiar esas variables en Environment; sync:false no las
actualiza durante siguientes sincronizaciones. No pegar .env completos ni imprimir
configuracion. DIRECT_URL no es necesaria para este build/start; se reserva para
migraciones manuales fuera de esta tarea. No configurar NEXT_PUBLIC_* en Render.

Ante un 403 `Origen no permitido` en `OPTIONS /api/me`, comparar el header
`Origin` de Network con `CORS_ORIGIN` del **Web Service que recibe el request**.
Pegar el origen exacto, sin comillas, rutas ni barra final. Si hay otros origenes
permitidos, conservarlos separados por coma. Un valor propio del servicio tiene
prioridad sobre los grupos de entorno. `Save only` guarda el valor para el
proximo deploy; cuando este autorizado, `Save and deploy` aplica el cambio
reutilizando el build actual. Repetir el preflight contra la API y comprobar
204 con `Access-Control-Allow-Origin` igual al origen solicitado.
[Variables de entorno en Render](https://render.com/docs/configure-environment-variables).

En Events, comprobar el SHA y la fecha del deploy Live para confirmar que
el cambio de entorno ya se aplico. Si /health responde `version: dev`,
ese valor es el fallback de RELEASE_SHA y no identifica el commit activo.

Preferir el pooler **Session** IPv4 de Supabase (normalmente puerto 5432) si la
conexion directa IPv6 no es accesible desde Render. Usar la URL real del panel del
proyecto, con password URL-encoded y sslmode=require. Si se elige Transaction
pooler (6543), revisar compatibilidad Prisma/pgbouncer y limites antes de cambiar;
no probar credenciales reales en logs ni ejecutar migraciones para comprobarlo.

GEMINI_API_KEY es opcional: omitirla deja explicaciones en 503 AI_UNAVAILABLE,
sin impedir startup. El resto de limites IA conserva defaults existentes.
Las credenciales privilegiadas del backend se configuran solo en Render.

## Validacion local Linux, sin secretos ni BD remota

```powershell
docker build -f infra/render/Dockerfile.check -t turnosmart-render-check .
docker run -d --name turnosmart-render-check -p 127.0.0.1:43129:43129 turnosmart-render-check
Invoke-RestMethod http://127.0.0.1:43129/health
docker rm -f turnosmart-render-check
npm run lint
npm run typecheck
```

Docker usa Node 22 Debian/OpenSSL 3, allowlist sin .env/frontend/tests/migraciones,
los mismos Build/Start Commands y valores ficticios. El smoke carga shared y Prisma
real (P1001 contra localhost cerrado prueba que carga el motor), verifica PORT,
health 200, ready 503 sin BD, auth 401, preflight Vercel 204 y origen ajeno 403.
La prueba del puerto publicado confirma accesibilidad fuera del contenedor.
No valida credenciales/conectividad reales ni reemplaza la validacion de Render.

## Ventana autorizada y limites Free

Antes de demo: confirmar Free/Node/raiz/comandos/variables y Auto-Deploy
After CI Checks Pass. Verificar `https://<servicio>.onrender.com/health` (200) y /ready (200
con Supabase), CORS desde el origen permitido, sin token 401 y login real contra el
backend. /health solo verifica proceso; no prueba BD, auth remota ni aislamiento RLS.
No usar /ready como health check de plataforma para evitar reinicios por BD pausada.

Para rollback, poner Auto-Deploy en Off y volver a un deploy exitoso desde
Events (o seleccionar su SHA mediante Manual Deploy → Deploy a specific commit).
Verificar /health y /ready, revertir o corregir `dev` y restablecer checksPass
cuando CI este verde. Si fallaron corridas o Render no detecto un cambio tras
una pausa, comparar el SHA desplegado con `dev` y recuperar manualmente desde
un SHA validado. El build Linux de Render instala y genera Prisma en su entorno.

Free se suspende tras 15 minutos sin trafico y el primer request puede tardar cerca
de un minuto; hay limites de horas compartidas, memoria, trafico y minutos de build.
Un volumen alto de llamadas a BD/API externas tambien puede causar suspension.
No mantenerlo despierto artificialmente. Ante limites, detener/revisar con el
equipo, sin upgrade automatico. Registrar ventana/uso y eliminar el servicio de demo
al terminar desde su Dashboard; no eliminar Supabase ni datos compartidos.

Referencias: [Node](https://render.com/docs/node-version),
[monorepos](https://render.com/docs/monorepo-support),
[Blueprint](https://render.com/docs/blueprint-spec),
[puerto](https://render.com/docs/web-services#port-binding),
[Free](https://render.com/docs/free),
[Supabase/Prisma](https://supabase.com/docs/guides/database/prisma).
