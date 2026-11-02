[CmdletBinding()]
param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot 'build/azure' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Linux requerido.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
& docker build --platform linux/amd64 --file (Join-Path $PSScriptRoot 'Dockerfile.artifact') `
    --target export --output "type=local,dest=$OutputDirectory" $repoRoot
if ($LASTEXITCODE -ne 0) { throw 'Fallo build/verificacion del ZIP Linux; no desplegar.' }
$zip = Join-Path $OutputDirectory 'backend.zip'
if (-not (Test-Path -LiteralPath $zip)) { throw 'No se genero backend.zip.' }
Get-FileHash -LiteralPath $zip -Algorithm SHA256 | Format-List
Write-Host "ZIP verificado localmente: $zip"
