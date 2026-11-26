[CmdletBinding()]
param(
    [ValidateSet('Validate', 'Preflight', 'WhatIf', 'Deploy', 'Remove')][string]$Action = 'Validate',
    [string]$SubscriptionId,
    [ValidatePattern('^rg-turnosmart-[a-z0-9-]+-temp$')][string]$ResourceGroupName,
    [ValidatePattern('^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$')][string]$AppName,
    [ValidatePattern('^[a-zA-Z0-9-]{1,40}$')][string]$PlanName,
    [string]$Location = 'eastus',
    [ValidateSet('F1', 'B1')][string]$Sku = 'F1',
    [string]$ExpiresOn,
    [string]$ZipPath = '',
    [string]$BicepPath = 'bicep',
    [switch]$ApproveB1,
    [switch]$ApproveDeployment,
    [string]$ConfirmResourceGroup
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$template = Join-Path $PSScriptRoot 'main.bicep'
function Invoke-Az {
    param([string[]]$Arguments, [switch]$Sensitive)
    if ($Sensitive) { $result = & az @Arguments 2>$null }
    else { $result = & az @Arguments }
    if ($LASTEXITCODE -ne 0) { throw 'Azure CLI fallo. No hay cambio automatico de SKU. Revisar permisos/region/estado antes de reintentar.' }
    return $result
}
function Test-Node22LinuxRuntime {
    param([object[]]$Runtimes)
    foreach ($runtime in $Runtimes) {
        if ($runtime -is [string]) {
            if ($runtime -ieq 'NODE:22-lts') { return $true }
            continue
        }
        if ($null -eq $runtime) { continue }
        $properties = $runtime.PSObject.Properties
        $os = $properties['os']
        $family = $properties['runtime']
        $config = $properties['config']
        $support = $properties['support']
        if ($os -and $family -and $config -and $support -and
            $os.Value -ieq 'Linux' -and $family.Value -ieq 'Node' -and
            $config.Value -ieq 'NODE|22-lts' -and
            $support.Value -iin @('Active', 'Near', 'n/a')) { return $true }
    }
    return $false
}
if ($Action -eq 'Validate') {
    $out = Join-Path $repoRoot 'build/azure/main.json'
    New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
    if (Get-Command $BicepPath -ErrorAction SilentlyContinue) {
        & $BicepPath build $template --outfile $out
        if ($LASTEXITCODE -ne 0) { throw 'Bicep invalido.' }
    } elseif (Get-Command az -ErrorAction SilentlyContinue) {
        Invoke-Az -Arguments @('bicep', 'build', '--file', $template, '--outfile', $out) | Out-Null
    } else { throw 'Instalar Bicep CLI o Azure CLI + az bicep install. Validate no requiere login.' }
    Write-Host "Bicep compilado localmente: $out"
    return
}
if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI requerida; no se ejecuto ninguna operacion Azure.' }
if (-not $SubscriptionId -or -not $ResourceGroupName) { throw 'SubscriptionId y ResourceGroupName explicitos son obligatorios.' }
if ($Sku -eq 'B1' -and $Action -ne 'Remove' -and -not $ApproveB1) { throw 'B1 tiene costo: requiere -ApproveB1 despues de aprobacion del equipo.' }
Invoke-Az -Arguments @('account', 'show', '--subscription', $SubscriptionId, '--query', 'id', '-o', 'tsv') | Out-Null

if ($Action -eq 'Remove') {
    if ($ConfirmResourceGroup -cne $ResourceGroupName) { throw 'ConfirmResourceGroup debe coincidir exactamente con el RG temporal a eliminar.' }
    $exists = Invoke-Az -Arguments @('group', 'exists', '--subscription', $SubscriptionId, '--name', $ResourceGroupName, '-o', 'tsv')
    if ($exists -eq 'false') { Write-Host 'RG inexistente; limpieza completa.'; return }
    $tags = (Invoke-Az -Arguments @('group', 'show', '--subscription', $SubscriptionId, '-n', $ResourceGroupName, '--query', 'tags', '-o', 'json')) | ConvertFrom-Json
    if ($tags.project -ne 'TurnoSmart' -or $tags.lifecycle -ne 'checkpoint-temporary') { throw 'RG sin etiquetas de propiedad temporal; no se elimina.' }
    Invoke-Az -Arguments @('group', 'delete', '--subscription', $SubscriptionId, '-n', $ResourceGroupName, '--yes', '--output', 'none') | Out-Null
    if ((Invoke-Az -Arguments @('group', 'exists', '--subscription', $SubscriptionId, '-n', $ResourceGroupName, '-o', 'tsv')) -ne 'false') { throw 'El RG aun existe: verificar limpieza y costos.' }
    Write-Host 'RG eliminado por completo; reconciliar costo real en docs/costs.md.'
    return
}

# Solo lectura: no crea un RG para ejecutar what-if ni habilita proveedores.
$runtimes = Invoke-Az -Arguments @('webapp', 'list-runtimes', '--os', 'linux', '--subscription', $SubscriptionId, '-o', 'json') | ConvertFrom-Json
if (-not (Test-Node22LinuxRuntime -Runtimes $runtimes)) { throw 'Node 22 Linux no figura como runtime soportado; detener y revisar.' }
$regions = Invoke-Az -Arguments @('appservice', 'list-locations', '--sku', $Sku, '--linux-workers-enabled', '--subscription', $SubscriptionId, '-o', 'json') | ConvertFrom-Json
if (-not ($regions | Where-Object { ($_.name -replace ' ', '').ToLowerInvariant() -eq ($Location -replace ' ', '').ToLowerInvariant() })) { throw 'SKU Linux no disponible en la region. No se cambia a B1 automaticamente.' }
if ($Action -eq 'Preflight') { Write-Host 'Runtime/region publicados compatibles; falta validar cuota/politicas/capacidad de la suscripcion.'; return }
if (-not $AppName -or -not $PlanName -or -not $ExpiresOn) { throw 'AppName, PlanName y ExpiresOn son obligatorios.' }
$expiry = [datetime]::ParseExact($ExpiresOn, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
if ($expiry.Date -lt [datetime]::UtcNow.Date) { throw 'ExpiresOn debe ser hoy o una fecha futura.' }
if ($Action -eq 'Deploy') {
    if (-not $ApproveDeployment) { throw 'Despliegue manual requiere -ApproveDeployment durante el checkpoint.' }
    if (-not $ZipPath) { $ZipPath = Join-Path $repoRoot 'build/azure/backend.zip' }
    if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) { throw 'Primero generar/verificar el ZIP con Build-Artifact.ps1.' }
    foreach ($name in @('DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'CORS_ORIGIN')) {
        if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Variable de proceso requerida: $name (no editar .env)." }
    }
    $exists = Invoke-Az -Arguments @('group', 'exists', '--subscription', $SubscriptionId, '-n', $ResourceGroupName, '-o', 'tsv')
    if ($exists -eq 'true') {
        $tags = (Invoke-Az -Arguments @('group', 'show', '--subscription', $SubscriptionId, '-n', $ResourceGroupName, '--query', 'tags', '-o', 'json')) | ConvertFrom-Json
        if ($tags.project -ne 'TurnoSmart' -or $tags.lifecycle -ne 'checkpoint-temporary') { throw 'No se reutiliza un RG ajeno al checkpoint.' }
    }
}
# What-if estructural usa placeholders, nunca secretos reales (what-if puede mostrar valores).
$values = @{
    resourceGroupName = $ResourceGroupName; appName = $AppName; planName = $PlanName
    location = $Location; sku = $Sku; expiresOn = $ExpiresOn
    corsOrigin = 'https://demo.invalid'; supabaseUrl = 'https://supabase.invalid'
    supabaseAnonKey = 'what-if-placeholder'; databaseUrl = 'postgresql://placeholder.invalid/db'
}
if ($Action -eq 'Deploy') {
    $values.corsOrigin = $env:CORS_ORIGIN; $values.supabaseUrl = $env:SUPABASE_URL
    $values.supabaseAnonKey = $env:SUPABASE_ANON_KEY; $values.databaseUrl = $env:DATABASE_URL
}
$parameters = @{}
foreach ($key in $values.Keys) { $parameters[$key] = @{ value = $values[$key] } }
$parameterFile = [IO.Path]::GetTempFileName()
try {
    @{ parameters = $parameters } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $parameterFile -Encoding utf8
    $verb = if ($Action -eq 'WhatIf') { 'what-if' } else { 'create' }
    $arguments = @('deployment', 'sub', $verb, '--subscription', $SubscriptionId, '--location', $Location,
        '--name', "$ResourceGroupName-infra", '--template-file', $template, '--parameters', "@$parameterFile")
    if ($Action -eq 'WhatIf') { Invoke-Az -Arguments $arguments }
    else {
        Invoke-Az -Arguments ($arguments + @('--output', 'none')) -Sensitive | Out-Null
        Invoke-Az -Arguments @('webapp', 'deploy', '--subscription', $SubscriptionId, '--resource-group', $ResourceGroupName,
            '--name', $AppName, '--src-path', ([IO.Path]::GetFullPath($ZipPath)), '--type', 'zip', '--clean', 'true', '--restart', 'true', '--output', 'none') -Sensitive | Out-Null
        Write-Host "Desplegado. Validar https://$AppName.azurewebsites.net/health y /ready; eliminar RG al cerrar."
    }
} finally {
    Remove-Item -LiteralPath $parameterFile -Force
}
