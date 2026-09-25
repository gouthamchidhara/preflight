<#
.SYNOPSIS
  Install (or upgrade) the Preflight agent as a Windows service. Run as Administrator.
.EXAMPLE
  .\install.ps1 -Server https://preflight.corp.example -Token <bootstrap token>
.EXAMPLE
  .\install.ps1            # install without a server: use "PreflightAgent.exe check" locally
.NOTES
  SCCM: powershell.exe -ExecutionPolicy Bypass -File install.ps1 -Server ... -Token ...
        Detection rule: service "PreflightAgent" exists.
#>
[CmdletBinding()]
param(
    [string]$Server,
    [string]$Token,
    [string]$InstallDir = (Join-Path $env:ProgramFiles 'Preflight'),
    [switch]$NoService
)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this in an Administrator PowerShell.' }
if (($Server -and -not $Token) -or ($Token -and -not $Server)) { throw 'Give both -Server and -Token, or neither.' }
if ($Token -and $Token.Length -lt 16) { throw 'Token looks wrong (must be at least 16 characters).' }

$src = $PSScriptRoot
$svcExe = Join-Path $InstallDir 'PreflightAgent-service.exe'
$data = Join-Path $env:ProgramData 'Preflight'

# 1. stop an existing install (upgrade path)
if (Get-Service -Name PreflightAgent -ErrorAction SilentlyContinue) {
    Write-Host 'Stopping existing Preflight Agent service...'
    & $svcExe stop 2>&1 | Out-Null
    Start-Sleep -Seconds 2
}

# 2. files
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
foreach ($item in 'PreflightAgent.exe', 'PreflightAgent-service.exe', 'PreflightAgent-service.xml', 'golden.json', 'checks', 'scripts', 'install.ps1', 'uninstall.ps1') {
    $p = Join-Path $src $item
    if (Test-Path $p) { Copy-Item -Path $p -Destination $InstallDir -Recurse -Force }
}

# 3. data dir: SYSTEM + Administrators only (PLAN.md §8)
if (-not (Test-Path $data)) { New-Item -ItemType Directory -Path $data -Force | Out-Null }
& icacls.exe $data /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null

# 4. config: the service enrolls itself on start and then deletes the token from disk
if ($Server) {
    $cfgPath = Join-Path $data 'config.json'
    $cfg = @{}
    if (Test-Path $cfgPath) { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json | ForEach-Object { $h = @{}; $_.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }; $h } }
    $cfg['serverUrl'] = $Server.TrimEnd('/')
    $cfg['bootstrapToken'] = $Token
    $cfg.Remove('deviceId')
    Remove-Item (Join-Path $data 'device.key.dpapi') -Force -ErrorAction SilentlyContinue
    ($cfg | ConvertTo-Json) | Set-Content -Path $cfgPath -Encoding UTF8
    Write-Host "Configured server $Server"
}

# 5. service
if (-not $NoService) {
    if (-not (Get-Service -Name PreflightAgent -ErrorAction SilentlyContinue)) {
        & $svcExe install
        if ($LASTEXITCODE -ne 0) { throw "service install failed ($LASTEXITCODE)" }
    }
    & $svcExe start
    Start-Sleep -Seconds 3
    Get-Service PreflightAgent | Format-Table -AutoSize Name, Status, StartType
}

Write-Host ''
Write-Host "Installed to $InstallDir"
Write-Host "Try now:   & '$InstallDir\PreflightAgent.exe' check"
Write-Host "Status:    & '$InstallDir\PreflightAgent.exe' status"
Write-Host "Logs:      $data\logs"
