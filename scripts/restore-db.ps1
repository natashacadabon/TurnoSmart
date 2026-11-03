param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [Parameter(Mandatory = $true)]
  [string]$TargetDatabaseUrl,
  [Parameter(Mandatory = $true)]
  [ValidateSet('RESTORE_TEST_DATABASE')]
  [string]$ConfirmRestore
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
  throw "No existe el backup: $BackupFile"
}

if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) {
  throw 'pg_restore no está instalado o no está disponible en PATH.'
}

pg_restore --clean --if-exists --no-owner --dbname=$TargetDatabaseUrl $BackupFile
Write-Output 'Backup restaurado en la base de prueba indicada.'
