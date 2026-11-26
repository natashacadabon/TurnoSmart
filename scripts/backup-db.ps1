#Requires -Version 7.4
[CmdletBinding(DefaultParameterSetName = 'Backup')]
param(
  [Parameter(Mandatory, ParameterSetName = 'Key')][switch]$GenerateKey,
  [string]$KeyFile = $env:BACKUP_KEY_FILE,
  [Parameter(Mandatory, ParameterSetName = 'Backup')]
  [ValidateSet('local', 'staging', 'production')][string]$SourceEnvironment,
  [Parameter(Mandatory, ParameterSetName = 'Backup')][string]$ExpectedDatabase,
  [string]$OutputDirectory,
  [ValidateSet('direct', 'session')][string]$ConnectionMode = 'direct',
  [string]$SourceContainer,
  [string]$DatabaseUser = 'postgres',
  [string]$PgDumpPath = 'pg_dump',
  [string]$PsqlPath = 'psql'
)
$ErrorActionPreference = 'Stop'
$node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$arguments = @((Join-Path $PSScriptRoot 'database-backup.mjs'))
if ($GenerateKey) { $arguments += 'init-key' } else { $arguments += 'backup' }
$arguments += @('--key-file', $KeyFile)
if (-not $GenerateKey) {
  $arguments += @('--environment', $SourceEnvironment, '--database', $ExpectedDatabase,
    '--connection-mode', $ConnectionMode, '--database-user', $DatabaseUser,
    '--pg-dump', $PgDumpPath, '--psql', $PsqlPath)
  if ($OutputDirectory) { $arguments += @('--output-directory', $OutputDirectory) }
  if ($SourceContainer) { $arguments += @('--source-container', $SourceContainer) }
}
& $node.Source @arguments
exit $LASTEXITCODE
