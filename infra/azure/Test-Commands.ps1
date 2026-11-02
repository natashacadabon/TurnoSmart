# Pruebas locales de los guardrails. az es un doble; nunca llama Azure CLI.
$ErrorActionPreference = 'Stop'
$global:TurnoSmartAzureTestState = @{
    called = [Collections.Generic.List[string]]::new(); parameterFile = ''; groupExists = $false; owned = $true
    runtimeResponse = 'legacy-valid'; regionAvailable = $true; failWhatIf = $false
}
function az {
    $a = @($args)
    $global:LASTEXITCODE = 0
    $global:TurnoSmartAzureTestState.called.Add(($a[0..1] -join ' '))
    switch ($a[0..1] -join ' ') {
        'account show' { return 'test-subscription' }
        'webapp list-runtimes' {
            switch ($global:TurnoSmartAzureTestState.runtimeResponse) {
                'legacy-valid' { return '["NODE:22-lts"]' }
                'legacy-wrong-version' { return '["NODE:24-lts"]' }
                'structured-valid' { return '[{"os":"Linux","runtime":"Node","version":"22.0 LTS","config":"NODE|22-lts","support":"Active","end_of_life":"2027-04-30"}]' }
                'structured-near' { return '[{"os":"Linux","runtime":"Node","version":"22.0 LTS","config":"NODE|22-lts","support":"Near","end_of_life":"2026-12-01"}]' }
                'structured-wrong-version' { return '[{"os":"Linux","runtime":"Node","version":"24.0 LTS","config":"NODE|24-lts","support":"Active","end_of_life":"2028-04-30"}]' }
                'structured-eol' { return '[{"os":"Linux","runtime":"Node","version":"22.0 LTS","config":"NODE|22-lts","support":"EOL","end_of_life":"2025-04-30"}]' }
                'empty' { return '[]' }
                default { throw 'Respuesta de runtimes no configurada en la prueba.' }
            }
        }
        'appservice list-locations' {
            if (-not $global:TurnoSmartAzureTestState.regionAvailable) { return '[]' }
            return '[{"name":"East US"}]'
        }
        'group exists' { return $global:TurnoSmartAzureTestState.groupExists.ToString().ToLowerInvariant() }
        'group show' {
            if ($global:TurnoSmartAzureTestState.owned) { return '{"project":"TurnoSmart","lifecycle":"checkpoint-temporary"}' }
            return '{"project":"other"}'
        }
        'group delete' { $global:TurnoSmartAzureTestState.groupExists = $false; return }
        'deployment sub' {
            $global:TurnoSmartAzureTestState.parameterFile = $a[[array]::IndexOf($a, '--parameters') + 1].Substring(1)
            $p = Get-Content -LiteralPath $global:TurnoSmartAzureTestState.parameterFile -Raw | ConvertFrom-Json
            if ($a[2] -eq 'what-if' -and $p.parameters.databaseUrl.value -ne 'postgresql://placeholder.invalid/db') { throw 'What-if filtro secretos incorrectamente.' }
            if ($global:TurnoSmartAzureTestState.failWhatIf) { $global:LASTEXITCODE = 1 }
            return
        }
        'webapp deploy' { return }
        default { throw 'Comando Azure inesperado en prueba.' }
    }
}
function Assert-Throws {
    param([scriptblock]$Run, [string]$Expected)
    try { & $Run; throw 'No fallo como se esperaba.' }
    catch { if ($_.Exception.Message -notlike "*$Expected*") { throw } }
}
$command = Join-Path $PSScriptRoot 'Invoke-Azure.ps1'
$common = @{
    SubscriptionId = 'test-subscription'; ResourceGroupName = 'rg-turnosmart-test-temp'
    AppName = 'turnosmart-test-backend'; PlanName = 'turnosmart-test-plan'
    ExpiresOn = [datetime]::UtcNow.AddDays(1).ToString('yyyy-MM-dd')
}
Assert-Throws { & $command @common -Action Deploy -Sku B1 } '-ApproveB1'
Assert-Throws { & $command @common -Action Deploy } '-ApproveDeployment'
Assert-Throws { & $command @common -Action Remove -ConfirmResourceGroup 'rg-other-temp' } 'coincidir'
$global:TurnoSmartAzureTestState.runtimeResponse = 'legacy-wrong-version'
Assert-Throws { & $command @common -Action Preflight } 'Node 22 Linux'
$global:TurnoSmartAzureTestState.runtimeResponse = 'structured-wrong-version'
Assert-Throws { & $command @common -Action Preflight } 'Node 22 Linux'
$global:TurnoSmartAzureTestState.runtimeResponse = 'structured-eol'
Assert-Throws { & $command @common -Action Preflight } 'runtime soportado'
$global:TurnoSmartAzureTestState.runtimeResponse = 'empty'
Assert-Throws { & $command @common -Action Preflight } 'Node 22 Linux'
$global:TurnoSmartAzureTestState.runtimeResponse = 'structured-valid'
& $command @common -Action Preflight
$global:TurnoSmartAzureTestState.runtimeResponse = 'structured-near'
& $command @common -Action Preflight
$global:TurnoSmartAzureTestState.runtimeResponse = 'legacy-valid'
$global:TurnoSmartAzureTestState.regionAvailable = $false
Assert-Throws { & $command @common -Action WhatIf } 'SKU Linux'
$global:TurnoSmartAzureTestState.regionAvailable = $true
& $command @common -Action WhatIf
if (Test-Path -LiteralPath $global:TurnoSmartAzureTestState.parameterFile) { throw 'No se limpio el archivo temporal de parametros.' }
$global:TurnoSmartAzureTestState.failWhatIf = $true
Assert-Throws { & $command @common -Action WhatIf } 'Azure CLI fallo'
if (Test-Path -LiteralPath $global:TurnoSmartAzureTestState.parameterFile) { throw 'Parametros temporales retenidos despues de error.' }
$global:TurnoSmartAzureTestState.failWhatIf = $false
if ($global:TurnoSmartAzureTestState.called.Contains('group delete') -or $global:TurnoSmartAzureTestState.called.Contains('webapp deploy')) { throw 'What-if o guardrails hicieron escrituras.' }
$global:TurnoSmartAzureTestState.groupExists = $true
$global:TurnoSmartAzureTestState.owned = $false
Assert-Throws { & $command @common -Action Remove -ConfirmResourceGroup $common.ResourceGroupName } 'etiquetas'
$global:TurnoSmartAzureTestState.owned = $true
& $command @common -Action Remove -Sku B1 -ConfirmResourceGroup $common.ResourceGroupName 6>$null
if ($global:TurnoSmartAzureTestState.groupExists) { throw 'No se verifico la eliminacion completa.' }
foreach ($file in Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1') {
    $parseErrors = $null; $tokens = $null
    [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count) { throw "PowerShell invalido: $($file.Name)" }
}
Write-Host 'Guardrails PowerShell aprobados: B1/deploy explicitos, what-if sin secretos/escrituras, propiedad/confirmacion/limpieza RG y sintaxis.'
