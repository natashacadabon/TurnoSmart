#Requires -Version 7.4
[CmdletBinding(DefaultParameterSetName = 'Restore')]
param(
  [Parameter(Mandatory, ParameterSetName = 'Restore')][string]$BackupFile,
  [Parameter(Mandatory, ParameterSetName = 'Restore')]
  [ValidateSet('local', 'staging', 'production')][string]$ExpectedEnvironment,
  [Parameter(Mandatory, ParameterSetName = 'Restore')]
  [ValidateSet('RESTORE_TEST_DATABASE')][string]$ConfirmRestore,
  [string]$KeyFile = $env:BACKUP_KEY_FILE,
  [string]$TargetName,
  [string]$PostgresImage = 'postgres:16-alpine@sha256:890480b08124ce7f79960a9bb16fe39729aa302bd384bfd7c408fee6c8f7adb7',
  [ValidateRange(256, 16384)][int]$MemoryMb = 1024,
  [Parameter(Mandatory, ParameterSetName = 'Cleanup')][string]$CleanupContainerId,
  [Parameter(Mandatory, ParameterSetName = 'Cleanup')][string]$CleanupToken,
  [Parameter(Mandatory, ParameterSetName = 'Cleanup')]
  [ValidateSet('REMOVE_LOCAL_RECOVERY')][string]$ConfirmCleanup
)
$ErrorActionPreference = 'Stop'
$node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$arguments = @((Join-Path $PSScriptRoot 'database-backup.mjs'))
if ($PSCmdlet.ParameterSetName -eq 'Cleanup') {
  $arguments += @('cleanup', '--container-id', $CleanupContainerId, '--session-token', $CleanupToken)
} else {
  $arguments += @('restore', '--backup-file', $BackupFile, '--key-file', $KeyFile,
    '--environment', $ExpectedEnvironment, '--image', $PostgresImage, '--memory-mb', "$MemoryMb")
  if ($TargetName) { $arguments += @('--target-name', $TargetName) }
}
& $node.Source @arguments
exit $LASTEXITCODE
