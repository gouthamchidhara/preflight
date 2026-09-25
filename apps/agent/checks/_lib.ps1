# Shared helpers for Preflight check + fix scripts (PLAN.md §6.2). Windows PowerShell 5.1 compatible.
#
# Contract for check scripts:
#   - input:  $env:PREFLIGHT_PARAMS = base64(JSON params)
#   - output: exactly one JSON line via Out-Result, then exit 0
#   - READ-ONLY: a check never changes the system
#   - an unset golden value ("TBD...") => report what was found as needs_human, never guess
#   - PowerShell variables are case-insensitive: never name a variable $p (it IS $P, the params)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

function Get-Params {
    if (-not $env:PREFLIGHT_PARAMS) { return [pscustomobject]@{} }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:PREFLIGHT_PARAMS))
    if (-not $json -or $json -eq 'null') { return [pscustomobject]@{} }
    return ($json | ConvertFrom-Json)
}

function Out-Result {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [ValidateSet('pass', 'fail', 'skip', 'needs_human', 'error')]
        [string]$Status,
        $Expected = $null,
        $Actual = $null,
        [hashtable]$Evidence = @{},
        [ValidateSet('not_applicable', 'precondition')]
        [string]$SkipReason = 'precondition'
    )
    $o = [ordered]@{ status = $Status; expected = $Expected; actual = $Actual; evidence = $Evidence }
    if ($Status -eq 'skip') { $o['skipReason'] = $SkipReason }
    Write-Output (ConvertTo-Json -InputObject $o -Depth 8 -Compress)
    exit 0
}

# Runs the check body; any unexpected exception becomes a single 'error' result.
function Invoke-Check([scriptblock]$Body) {
    try {
        & $Body
    }
    catch {
        Out-Result error -Actual ('script error: ' + $_.Exception.Message) -Evidence @{ line = "$($_.InvocationInfo.ScriptLineNumber)" }
    }
    Out-Result error -Actual 'check produced no verdict'
}

# True for golden placeholders: $null, "TBD...", or ["TBD..."].
function Test-Tbd($v) {
    if ($null -eq $v) { return $true }
    if ($v -is [string]) { return $v.StartsWith('TBD') }
    if ($v -is [array] -and $v.Count -eq 1) { return (Test-Tbd $v[0]) }
    return $false
}

# Only paths that exist. Windows PowerShell 5.1 quirk: `Get-ChildItem <missing dir> -Recurse` does not
# fail; it treats the name as a filter and crawls the whole parent (e.g. all of C:\Program Files).
function Get-ExistingPaths([string[]]$Paths) {
    return @($Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
}

function Get-UserProfilePath([string]$User) {
    try {
        $sid = (Get-LocalUser -Name $User -ErrorAction Stop).SID.Value
        $p = (Get-CimInstance Win32_UserProfile -Filter "SID='$sid'" -ErrorAction Stop).LocalPath
        if ($p) { return $p }
    }
    catch { }
    return (Join-Path $env:SystemDrive "Users\$User")
}

# "%USERPROFILE:Mechanic%\Desktop" -> "C:\Users\Mechanic\Desktop"
function Expand-PfPath([string]$Path) {
    $m = [regex]::Match($Path, '%USERPROFILE:([^%]+)%')
    while ($m.Success) {
        $Path = $Path.Replace($m.Value, (Get-UserProfilePath $m.Groups[1].Value))
        $m = [regex]::Match($Path, '%USERPROFILE:([^%]+)%')
    }
    return $Path
}

# Runs $Body with the user's registry root (HKU\<SID> if logged on, else NTUSER.DAT loaded under a
# unique temp name). The hive is always unloaded, even when the body exits.
function Invoke-WithUserHive([string]$User, [scriptblock]$Body) {
    $sid = (Get-LocalUser -Name $User -ErrorAction Stop).SID.Value
    $root = "Registry::HKEY_USERS\$sid"
    $tmpName = "PF_$PID"
    $loaded = $false
    if (-not (Test-Path $root)) {
        $dat = Join-Path (Get-UserProfilePath $User) 'NTUSER.DAT'
        if (-not (Test-Path $dat)) { throw "registry hive not found for user $User" }
        & reg.exe load "HKU\$tmpName" $dat 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "reg load failed for $User (exit $LASTEXITCODE)" }
        $root = "Registry::HKEY_USERS\$tmpName"
        $loaded = $true
    }
    try {
        & $Body $root
    }
    finally {
        if ($loaded) {
            [gc]::Collect()
            [gc]::WaitForPendingFinalizers()
            & reg.exe unload "HKU\$tmpName" 2>&1 | Out-Null
        }
    }
}

# Registry values as a hashtable; REG_BINARY rendered as hex.
function Get-RegValues([string]$Path) {
    $h = @{}
    if (-not (Test-Path $Path)) { return $h }
    $p = Get-ItemProperty -Path $Path
    foreach ($prop in $p.PSObject.Properties) {
        if ($prop.Name -like 'PS*') { continue }
        $v = $prop.Value
        if ($v -is [byte[]]) { $v = ($v | ForEach-Object { $_.ToString('X2') }) -join '' }
        $h[$prop.Name] = $v
    }
    return $h
}

function Get-Sha256Text([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))
    return 'sha256:' + (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-FileSha256([string]$Path) {
    return 'sha256:' + (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
}

# "sha256:ABC" / "abc" -> "sha256:abc"
function ConvertTo-HashId([string]$h) {
    if (-not $h) { return $h }
    $h = $h.Trim().ToLower()
    if ($h.StartsWith('sha256:')) { return $h }
    return "sha256:$h"
}

# key=value pairs of a .properties file (comments skipped). Values are raw text after '='.
function Read-Properties([string]$Path) {
    $out = [ordered]@{}
    foreach ($line in (Get-Content -Path $Path)) {
        if ($line -match '^\s*[#!]' -or $line -notmatch '=') { continue }
        $i = $line.IndexOf('=')
        $k = $line.Substring(0, $i).Trim()
        if ($k) { $out[$k] = $line.Substring($i + 1).Trim() }
    }
    return $out
}

function Test-TcpPort([string]$HostName, [int]$Port, [int]$TimeoutMs = 5000) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $c.BeginConnect($HostName, $Port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs)) { return 'timeout' }
        $c.EndConnect($ar)
        return 'open'
    }
    catch {
        $m = $_.Exception.Message
        if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        return "error: $m"
    }
    finally { $c.Close() }
}

# Firefox profile dirs worth inspecting: the Mechanic profiles plus any legacy profile under C:\787.
function Get-FirefoxProfileDirs([string]$User, $ProfileDir) {
    if (-not (Test-Tbd $ProfileDir)) { return @((Expand-PfPath $ProfileDir)) }
    $roots = @((Join-Path (Get-UserProfilePath $User) 'AppData\Roaming\Mozilla\Firefox\Profiles'), 'C:\787')
    $dirs = @()
    foreach ($r in (Get-ExistingPaths $roots)) {
        $dirs += Get-ChildItem -LiteralPath $r -Recurse -Depth 5 -Filter prefs.js -ErrorAction SilentlyContinue | ForEach-Object { $_.DirectoryName }
    }
    return @($dirs | Select-Object -Unique)
}

# user_pref("name", value); from prefs.js, then user.js (user.js wins, as at Firefox start).
function Read-FirefoxPrefs([string]$Dir) {
    $prefs = @{}
    foreach ($f in @('prefs.js', 'user.js')) {
        $p = Join-Path $Dir $f
        if (-not (Test-Path $p)) { continue }
        foreach ($line in (Get-Content -Path $p)) {
            if ($line -match '^\s*user_pref\(\s*"([^"]+)"\s*,\s*(.+?)\s*\)\s*;') {
                $prefs[$Matches[1]] = $Matches[2].Trim('"')
            }
        }
    }
    return $prefs
}
