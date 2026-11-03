param([string]$TemplatePath = (Join-Path $PSScriptRoot '../../build/azure/main.json'))
$ErrorActionPreference = 'Stop'
$t = Get-Content -LiteralPath $TemplatePath -Raw | ConvertFrom-Json
function Assert-Policy { param([bool]$Condition, [string]$Message); if (-not $Condition) { throw $Message } }
Assert-Policy ($t.parameters.sku.defaultValue -eq 'F1') 'El default debe ser F1.'
Assert-Policy (($t.parameters.sku.allowedValues | Sort-Object) -join ',' -eq 'B1,F1') 'Solo se permite F1/B1.'
foreach ($name in @('databaseUrl', 'supabaseAnonKey')) {
    Assert-Policy ($t.parameters.$name.type -eq 'secureString') 'Secreto sin secureString.'
    Assert-Policy (-not ($t.parameters.$name.PSObject.Properties.Name -contains 'defaultValue')) 'No debe haber secretos por defecto.'
}
Assert-Policy ($t.resources.Count -eq 2) 'Solo RG temporal y deployment anidado.'
$rg = $t.resources | Where-Object type -eq 'Microsoft.Resources/resourceGroups'
Assert-Policy ($t.variables.tags.lifecycle -eq 'checkpoint-temporary' -and $rg.tags -eq "[variables('tags')]") 'Falta etiqueta de limpieza.'
$nested = ($t.resources | Where-Object type -eq 'Microsoft.Resources/deployments').properties.template
Assert-Policy (($nested.resources.type | Sort-Object) -join ',' -eq 'Microsoft.Web/serverfarms,Microsoft.Web/sites') 'Recursos adicionales no permitidos.'
$plan = $nested.resources | Where-Object type -eq 'Microsoft.Web/serverfarms'
$app = $nested.resources | Where-Object type -eq 'Microsoft.Web/sites'
Assert-Policy ($plan.sku.capacity -eq 1 -and $plan.properties.reserved) 'Se requiere una instancia Linux.'
Assert-Policy ($app.properties.httpsOnly) 'HTTPS Only obligatorio.'
Assert-Policy ($app.properties.siteConfig.linuxFxVersion -eq 'NODE|22-lts') 'Runtime debe ser Node 22.'
Assert-Policy (-not $app.properties.siteConfig.alwaysOn) 'Always On incompatible con F1.'
Assert-Policy ($app.properties.siteConfig.appCommandLine -eq 'node dist/index.js') 'Startup inconsistente con ZIP.'
$settings = $app.properties.siteConfig.appSettings
Assert-Policy (($settings | Where-Object name -eq 'SCM_DO_BUILD_DURING_DEPLOYMENT').value -eq 'false') 'No reconstruir ZIP en Azure.'
Assert-Policy (-not ($settings.name -contains 'PORT')) 'PORT debe proporcionarlo App Service.'
Write-Host 'Politicas Bicep aprobadas: F1, B1 opt-in, solo RG/plan/app, Linux/Node22, una instancia, HTTPS, sin servicios adicionales.'
