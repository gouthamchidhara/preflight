<#
.SYNOPSIS
  Install and enroll the Preflight Agent in one step.
.EXAMPLE
  .\onboard.ps1
.EXAMPLE
  .\onboard.ps1 -Server http://10.62.152.147:3002 -Token <bootstrap token>
##>
[CmdletBinding()]
param(
    [string]$Server = 'http://10.62.152.147:3002',
    [string]$Token
)

$ErrorActionPreference = 'Stop'
$scriptPath = $MyInvocation.MyCommand.Path
$scriptDir = Split-Path -Parent $scriptPath

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath, '-Server', $Server)
    if ($Token) { $args += @('-Token', $Token) }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $args | Out-Null
    exit 0
}

if (-not $Token) {
    $Token = Read-Host 'Enter the Preflight bootstrap token'
}
if ([string]::IsNullOrWhiteSpace($Token) -or $Token.Length -lt 16) {
    throw 'The bootstrap token must contain at least 16 characters.'
}

$install = Join-Path $scriptDir 'install.ps1'
$agent = Join-Path $env:ProgramFiles 'Preflight\PreflightAgent.exe'
if (-not (Test-Path $install)) { throw "Missing installer: $install" }

Write-Host "Installing and enrolling with $Server ..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $install -Server $Server -Token $Token
if ($LASTEXITCODE -ne 0) { throw "Agent installation failed ($LASTEXITCODE)." }

if (-not (Test-Path $agent)) { throw "Agent executable was not installed: $agent" }
Write-Host ''
Write-Host 'Enrollment status:'
& $agent status
if ($LASTEXITCODE -ne 0) { throw "Agent status failed ($LASTEXITCODE)." }

Write-Host ''
Write-Host 'Onboarding complete. Refresh the Preflight dashboard.'