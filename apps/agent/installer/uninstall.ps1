<#
.SYNOPSIS
  Remove the Preflight agent service and program files. Run as Administrator.
  -Purge also deletes ProgramData\Preflight (config, device key, queue, logs, backups).
#>
[CmdletBinding()]
param([string]$InstallDir = (Join-Path $env:ProgramFiles 'Preflight'), [switch]$Purge)
$ErrorActionPreference = 'Stop'
$svcExe = Join-Path $InstallDir 'PreflightAgent-service.exe'
if (Get-Service -Name PreflightAgent -ErrorAction SilentlyContinue) {
    & $svcExe stop 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    & $svcExe uninstall
}
Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
if ($Purge) { Remove-Item -Path (Join-Path $env:ProgramData 'Preflight') -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host 'Preflight agent removed.'
