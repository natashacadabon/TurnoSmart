# B07 — Azure minimo, M1–M2 (preparado, sin desplegar)

RG temporal → Plan Linux **F1** (default, una instancia compartida) → App Service
**Node 22**, HTTPS Only/TLS 1.2, `node dist/index.js`. Reutiliza Supabase Cloud;
sin BD Azure, frontend, registry, Key Vault, monitoreo pago ni deploy automatico.
No se modifican los workflows existentes. Nombres y region parametrizados.

## M1: build y validacion local

Requiere PowerShell 7, Docker Linux/BuildKit con salida a npm/Docker Hub y Bicep
CLI (o Azure CLI con `az bicep install`). No requiere login ni credenciales reales.

```powershell
./infra/azure/Build-Artifact.ps1
./infra/azure/Invoke-Azure.ps1 -Action Validate
./infra/azure/Test-Bicep.ps1
./infra/azure/Test-Commands.ps1  # az simulado, nunca opera Azure
npm run lint
npm run typecheck
```

Con Bicep portable: `-Action Validate -BicepPath <ruta/bicep.exe>`. Si .NET no puede
extraerse en el temp del sandbox, definir DOTNET_BUNDLE_EXTRACT_BASE_DIR en un
directorio local escribible antes de usar Bicep. No instalar herramientas al ZIP.

Salida ignorada por Git: `build/azure/backend.zip` y SHA256. Build aislado Linux
x64/Node 22, base Debian/OpenSSL 3 fijada por digest, dependencias de package-lock.
Genera/valida Prisma 6.12 sin conectar a una BD. Instala produccion y copia solo
el cierre de dependencias runtime (excluye Prisma CLI, peer opcional, y su tooling);
materializa shared sin enlaces workspace.
El ZIP tiene package.json con npm start, dist/, node_modules/ y build-info.json
(versiones/huella del lock). No necesita npm install/build en App Service: Oryx
deshabilitado. No se promete identidad byte a byte del ZIP entre builds.

La allowlist de contexto excluye `.env`, tests, frontend y migraciones. La prueba
extrae el ZIP y verifica dependencias, Prisma Linux cargado (P1001 contra puerto
local cerrado), shared, PORT=43127, health=200, ready=503 sin BD, auth=401 y CORS.
No llama Supabase/Gemini. No usar Prisma generado en Alpine/musl o Windows para
App Service Linux glibc/OpenSSL 3. El runtime Azure real se verifica en la demo.

## M2: solo durante el checkpoint, manual

Instalar Azure CLI, `az login`, y confirmar suscripcion, credito y presupuesto
con el equipo. Nunca ejecutar estos comandos desde CI. Preparar parametros:

```powershell
$cp = @{
  SubscriptionId = '<id>'; ResourceGroupName = 'rg-turnosmart-cp2-temp'
  AppName = 'turnosmart-cp2-<sufijo-unico>'; PlanName = 'asp-turnosmart-cp2'
  Location = 'eastus'; ExpiresOn = '2026-11-09' # fecha de limpieza UTC
}
./infra/azure/Invoke-Azure.ps1 @cp -Action Preflight
./infra/azure/Invoke-Azure.ps1 @cp -Action WhatIf
```

Preflight consulta runtime Node 22 y regiones Linux del SKU. No garantiza cuota,
capacidad, politicas ni disponibilidad del nombre; comprobarlos en la cuenta.
WhatIf es a nivel suscripcion: **no crea un RG**. Usa placeholders para evitar
mostrar secretos; solo revisa estructura, no conectividad/configuracion real.
Revisar F1, una instancia, RG exclusivo y ausencia de recursos adicionales.
Si F1 no es compatible, detenerse. **B1 solo con aprobacion del equipo**, pasando
`-Sku B1 -ApproveB1` tanto a Preflight/WhatIf como a Deploy; nunca hay fallback.

Variables de proceso requeridas al desplegar (no modificar `.env`):

- DATABASE_URL: URL runtime TLS del Supabase existente (pooler segun el proyecto).
- SUPABASE_URL y SUPABASE_ANON_KEY: proyecto existente, no service-role key.
- CORS_ORIGIN: origen HTTPS del frontend existente; multiples separados por coma.

Ingresar secretos con `Read-Host -MaskInput` y asignarlos a `$env:DATABASE_URL` y
`$env:SUPABASE_ANON_KEY`, sin pegarlos en comandos/historial. Cargar URL/origen en
sus variables de proceso. No pasar DIRECT_URL: no se ejecutan migraciones. Gemini
queda deshabilitado (503 para explicaciones); no se configura una clave paga.
App Settings guarda secretos sin Key Vault; limitar RBAC, no usar --debug ni
exportar configuracion. El script usa parametros secure y archivo temporal
(directorio privado del usuario), lo elimina en finally y suprime salidas sensibles.

```powershell
./infra/azure/Invoke-Azure.ps1 @cp -Action Deploy -ApproveDeployment
Invoke-RestMethod "https://$($cp.AppName).azurewebsites.net/health"
Invoke-RestMethod "https://$($cp.AppName).azurewebsites.net/ready"
./infra/azure/Invoke-Azure.ps1 @cp -Action Remove -ConfirmResourceGroup $cp.ResourceGroupName
Remove-Item Env:DATABASE_URL, Env:SUPABASE_ANON_KEY  # limpiar secretos de la sesion
```

Antes de la demo: restaurar Supabase si esta pausado; /health debe dar 200 y /ready
200 contra la BD existente. Probar un endpoint sin token (401) y uno autenticado
con el frontend existente/CORS. PORT lo proporciona App Service; no fijarlo ni
usar WEBSITES_PORT (este ultimo corresponde a contenedores personalizados).
Un fallo de deploy puede dejar RG/plan creados: ejecutar Remove y verificar cierre.

## Costos, riesgos y cierre

F1 no cobra compute dentro de sus limites, pero tiene cuotas, cold starts y no SLA;
no sirve para disponibilidad continua. HTTPS usa el dominio azurewebsites.net, sin
dominio/certificado comprado. **B1 cobra mientras el plan exista, incluso con la
app detenida**; verificar tarifa region/moneda/oferta y registrar credito consumido
como costo. Respetar el techo propuesto del equipo en [costos](../../docs/costs.md).
No se contratan servicios adicionales ni upgrades de Supabase/Gemini.

`expiresOn` es solo etiqueta: **no hay borrado automatico**. Remove exige nombre
temporal exacto y etiquetas TurnoSmart/checkpoint-temporary, elimina todo el RG y
espera hasta comprobar que no existe. Usar un RG exclusivo: borra su contenido.
Registrar ventana, SKU, horas, inventario vacio y costo real en docs/costs.md;
reconciliar al dia siguiente. Queda historial de deployment de suscripcion, sin
recursos facturables. No detener solo la Web App como sustituto de la limpieza.

Fuentes oficiales: [Node/PORT](https://learn.microsoft.com/azure/app-service/configure-language-nodejs),
[ZIP](https://learn.microsoft.com/azure/app-service/deploy-zip),
[SKU/regiones](https://learn.microsoft.com/cli/azure/appservice#az-appservice-list-locations),
[limites](https://learn.microsoft.com/azure/azure-resource-manager/management/azure-subscription-service-limits#app-service-limits)
y [precios Linux](https://azure.microsoft.com/pricing/details/app-service/linux/).
