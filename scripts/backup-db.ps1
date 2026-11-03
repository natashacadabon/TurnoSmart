param(
  [string]$OutputDirectory = "backups"
)

$ErrorActionPreference = 'Stop'

if (-not $env:DATABASE_URL) {
  throw 'DATABASE_URL no está configurada.'
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $OutputDirectory "turnosmart-$stamp.dump"

pg_dump --format=custom --no-owner --file=$target $env:DATABASE_URL
Write-Output "Backup creado en $target"
