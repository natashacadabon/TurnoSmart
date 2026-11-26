#Requires -Version 7.4
[CmdletBinding()]
param([Parameter(Mandatory)][string]$LiteralPath, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
try {
  $item = Get-Item -LiteralPath $LiteralPath -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe link' }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $item.FullName
  if (-not $CheckOnly) {
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($entry in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($entry) }
    $inheritance = [Security.AccessControl.InheritanceFlags]::None
    if ($item.PSIsContainer) {
      $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    }
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl',
      $inheritance, [Security.AccessControl.PropagationFlags]::None, 'Allow')
    [void]$acl.AddAccessRule($rule)
    $acl.SetOwner($sid)
    Set-Acl -LiteralPath $item.FullName -AclObject $acl
    $acl = Get-Acl -LiteralPath $item.FullName
  }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Owner' }
  foreach ($entry in $acl.Access) {
    if ($entry.AccessControlType -eq 'Allow' -and
        $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
      throw 'Shared permissions'
    }
  }
  if (-not $acl.AreAccessRulesProtected) { throw 'Inherited permissions' }
} catch {
  Write-Error 'No se pudo verificar/proteger el acceso privado al archivo de backup.' -ErrorAction Continue
  exit 1
}
