<#
.SYNOPSIS
  Phase 0 probe (PLAN.md §10). READ-ONLY snapshot of a UMD for building golden/manifest.json.

.DESCRIPTION
  Collects identity, OS, apps, desktop icons, disks (4 TB), WWAN/SIM, BIOS-visible state,
  Firefox/Acrobat prefs, LSAPL file hashes, SCCM programs, display and startup registry.
  Changes nothing on the device. Secrets are never written: application.properties values
  are SHA-256 hashed, and sensitive keys in connections.properties are redacted.

  Run twice around a manual step (-Label before-x / -Label after-x) and diff the two folders.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\probe\probe.ps1 -Label baseline
#>
[CmdletBinding()]
param(
  [string]$Label = 'baseline',
  [string]$OutRoot = 'C:\PreflightProbe',
  [string]$UserName = 'Mechanic'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host 'Run PowerShell as Administrator.' -ForegroundColor Red; exit 1 }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Out = Join-Path $OutRoot "$Label-$stamp"
New-Item -ItemType Directory -Path $Out -Force | Out-Null
$SensitiveKey = '(?i)pass|secret|token|pwd|key'

function Save-Json([string]$Name, [scriptblock]$Block) {
  $file = Join-Path $Out "$Name.json"
  try {
    $data = & $Block
    ConvertTo-Json -InputObject @($data) -Depth 6 | Out-File $file -Encoding utf8
    Write-Host "  ok   $Name"
  } catch {
    ConvertTo-Json -InputObject @{ error = $_.Exception.Message } | Out-File $file -Encoding utf8
    Write-Host "  err  $Name : $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Save-Text([string]$Name, [scriptblock]$Block) {
  $file = Join-Path $Out "$Name.txt"
  try {
    (& $Block 2>&1 | Out-String) | Out-File $file -Encoding utf8
    Write-Host "  ok   $Name"
  } catch {
    "error: $($_.Exception.Message)" | Out-File $file -Encoding utf8
    Write-Host "  err  $Name : $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Get-RegValues([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  $p = Get-ItemProperty -Path $Path
  $h = [ordered]@{}
  foreach ($prop in $p.PSObject.Properties) {
    if ($prop.Name -like 'PS*') { continue }
    $v = $prop.Value
    if ($v -is [byte[]]) { $v = ($v | ForEach-Object { $_.ToString('X2') }) -join '' }
    $h[$prop.Name] = $v
  }
  $h
}

function Get-RegTree([string]$Path) {
  if (-not (Test-Path $Path)) { return @() }
  $keys = @(Get-Item $Path) + @(Get-ChildItem $Path -Recurse -ErrorAction SilentlyContinue)
  foreach ($k in $keys) {
    [pscustomobject]@{ Key = $k.Name; Values = (Get-RegValues $k.PSPath) }
  }
}

# Windows PowerShell 5.1 quirk: `Get-ChildItem <missing dir> -Recurse` crawls the parent. Search only what exists.
function Get-ExistingPaths([string[]]$Paths) { @($Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) }) }

function Get-Sha256([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))
  'sha256:' + (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Read-Props([string]$Path) {
  # key=value lines of a .properties file (comments skipped); raw value text after '='
  Get-Content -Path $Path | Where-Object { $_ -match '^\s*[^#!\s][^=]*=' } | ForEach-Object {
    $i = $_.IndexOf('=')
    [pscustomobject]@{ Key = $_.Substring(0, $i).Trim(); Value = $_.Substring($i + 1).Trim() }
  }
}

function Get-Shortcuts([string]$Dir) {
  if (-not (Test-Path $Dir)) { return @() }
  $sh = New-Object -ComObject WScript.Shell
  Get-ChildItem -Path $Dir -Filter *.lnk -Force | ForEach-Object {
    $t = $sh.CreateShortcut($_.FullName).TargetPath
    [pscustomobject]@{ Name = $_.BaseName; Dir = $Dir; Target = $t; TargetExists = [bool]($t -and (Test-Path $t)) }
  }
}

Write-Host "Preflight probe -> $Out"

# ---------- Mechanic profile + hive (PLAN C6) ----------
$mech = $null; $mechProfile = $null; $hive = $null; $hiveLoaded = $false
try {
  $mech = Get-LocalUser -Name $UserName
  $mechProfile = (Get-CimInstance Win32_UserProfile | Where-Object SID -eq $mech.SID.Value).LocalPath
  if (-not $mechProfile) { $mechProfile = "C:\Users\$UserName" }
  if (Test-Path "Registry::HKEY_USERS\$($mech.SID.Value)") {
    $hive = "Registry::HKEY_USERS\$($mech.SID.Value)"
  } elseif (Test-Path "$mechProfile\NTUSER.DAT") {
    & reg.exe load 'HKU\PreflightProbe' "$mechProfile\NTUSER.DAT" | Out-Null
    if ($LASTEXITCODE -eq 0) { $hive = 'Registry::HKEY_USERS\PreflightProbe'; $hiveLoaded = $true }
  }
} catch { Write-Host "  warn user '$UserName' : $($_.Exception.Message)" -ForegroundColor Yellow }

try {
  # ---------- S1 image ----------
  Save-Json 'identity' {
    $cs = Get-CimInstance Win32_ComputerSystem
    $bios = Get-CimInstance Win32_BIOS
    $enc = Get-CimInstance Win32_SystemEnclosure
    [pscustomobject]@{
      Hostname = $env:COMPUTERNAME; Domain = $cs.Domain
      Manufacturer = $cs.Manufacturer; Model = $cs.Model; SystemSKU = $cs.SystemSKUNumber
      Serial = $bios.SerialNumber; AssetTag = $enc.SMBIOSAssetTag
      BiosVersion = $bios.SMBIOSBIOSVersion; BiosDate = $bios.ReleaseDate
    }
  }
  Save-Json 'os' {
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    [pscustomobject]@{ ProductName = $cv.ProductName; DisplayVersion = $cv.DisplayVersion
      CurrentBuild = $cv.CurrentBuild; UBR = $cv.UBR }
  }
  Save-Json 'mechanic-user' {
    if ($mech) { [pscustomobject]@{ Name = $mech.Name; Enabled = $mech.Enabled
      PasswordLastSet = $mech.PasswordLastSet; ProfilePath = $mechProfile; HiveRead = [bool]$hive } }
  }
  Save-Json 'apps' {
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' | ForEach-Object {
      Get-ItemProperty $_ -ErrorAction SilentlyContinue } |
      Where-Object DisplayName |
      Select-Object DisplayName, DisplayVersion, Publisher, InstallDate |
      Sort-Object DisplayName
  }
  Save-Json 'appx-intel-gcc' {
    Get-AppxPackage -AllUsers -Name '*IntelGraphicsExperience*' | Select-Object Name, Version, PackageFullName
  }
  Save-Json 'desktop-icons' {
    @(Get-Shortcuts 'C:\Users\Public\Desktop') + @(Get-Shortcuts "$mechProfile\Desktop")
  }
  Save-Json 'wallpaper' {
    $dir = "$mechProfile\AppData\Roaming\Microsoft\Windows\Themes"
    Get-ExistingPaths @($dir) | Get-ChildItem -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
      [pscustomobject]@{ Path = $_.FullName; Size = $_.Length; LastWrite = $_.LastWriteTime
        Sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() } }
  }
  Save-Text 'gpresult' { & gpresult.exe /scope computer /r }

  # ---------- S2 config ----------
  Save-Json 'toolbox-folder' {
    Get-ChildItem 'C:\787\ToolboxRemote787' -Force |
      Select-Object Name, Length, LastWriteTime, PSIsContainer
  }
  Save-Json 'lsapl-files' {
    'C:\com-code-client\connections.properties',
    'C:\com-code-client\ee-prod-smt-trust.jks',
    'C:\Boeing\LSAPL-SMT\App\conf\connections.properties',
    'C:\Boeing\LSAPL-SMT\Keys\ee-prod-smt-trust.jks',
    'C:\Boeing\LSAPL-SMT\App\conf\application.properties' | ForEach-Object {
      $exists = Test-Path $_
      $hash = $null; if ($exists) { $hash = (Get-FileHash $_ -Algorithm SHA256).Hash.ToLower() }
      [pscustomobject]@{ Path = $_; Exists = $exists; Sha256 = $hash }
    }
  }
  Save-Json 'lsapl-connections-props' {
    Read-Props 'C:\Boeing\LSAPL-SMT\App\conf\connections.properties' | ForEach-Object {
      $v = $_.Value; if ($_.Key -match $SensitiveKey) { $v = '<redacted>' }
      [pscustomobject]@{ Key = $_.Key; Value = $v } }
  }
  Save-Json 'lsapl-app-props' {
    # Key names only. The two credential values are hashed, never written.
    Read-Props 'C:\Boeing\LSAPL-SMT\App\conf\application.properties' | ForEach-Object {
      $h = $null
      if ($_.Key -in @('deviceLoginPassword', 'trustStorePassword')) { $h = Get-Sha256 $_.Value }
      [pscustomobject]@{ Key = $_.Key; ValueSha256 = $h } }
  }
  Save-Json 'lsapl-logs' {
    Get-ExistingPaths @('C:\Boeing\LSAPL-SMT') | Get-ChildItem -Recurse -File -Include *.log, *.txt -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 20 FullName, Length, LastWriteTime
  }
  Save-Json 'services' {
    Get-Service | Where-Object { $_.Name -match '(?i)airwall|tempered|lsapl|tomcat|ccmexec|wwansvc' -or
      $_.DisplayName -match '(?i)airwall|tempered|lsapl|tomcat' } |
      Select-Object Name, DisplayName, Status, StartType
  }
  Save-Json 'firefox' {
    $exes = Get-ExistingPaths @('C:\Program Files', 'C:\Program Files (x86)', 'C:\787') | Get-ChildItem -Recurse -Depth 4 `
      -Filter firefox.exe -ErrorAction SilentlyContinue |
      ForEach-Object { [pscustomobject]@{ Path = $_.FullName; Version = $_.VersionInfo.ProductVersion } }
    $profileRoots = @("$mechProfile\AppData\Roaming\Mozilla\Firefox\Profiles", 'C:\787')
    $profiles = Get-ExistingPaths $profileRoots | Get-ChildItem -Recurse -Depth 5 -Filter prefs.js -ErrorAction SilentlyContinue |
      ForEach-Object {
        $d = $_.DirectoryName
        $pick = { param($f) if (Test-Path $f) { Select-String -Path $f -Pattern 'pdf|plugin\.state|nppdf|acrobat' |
          ForEach-Object { $_.Line.Trim() } } }
        [pscustomobject]@{
          ProfileDir = $d
          Prefs      = @(& $pick "$d\prefs.js")
          UserJs     = @(& $pick "$d\user.js")
          Handlers   = @(& $pick "$d\handlers.json")
          MimeTypes  = @(& $pick "$d\mimeTypes.rdf")
        } }
    $npapi = Get-ExistingPaths @('C:\Program Files\Adobe', 'C:\Program Files (x86)\Adobe') | Get-ChildItem -Recurse `
      -Filter nppdf32.dll -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
    [pscustomobject]@{ Executables = @($exes); Profiles = @($profiles); AcrobatPlugin = @($npapi)
      PublicDesktopFirefoxLnk = @(Get-ChildItem 'C:\Users\Public\Desktop' -Filter '*firefox*.lnk' -ErrorAction SilentlyContinue).Name }
  }
  Save-Json 'startup-mechanic' {
    if ($hive) {
      [pscustomobject]@{
        Run            = Get-RegValues "$hive\Software\Microsoft\Windows\CurrentVersion\Run"
        StartupApproved = Get-RegValues "$hive\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
        HklmRun        = Get-RegValues 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
        HklmApproved   = Get-RegValues 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
        Wallpaper      = (Get-RegValues "$hive\Control Panel\Desktop").WallPaper
      } }
  }
  Save-Json 'display' {
    [pscustomobject]@{
      Video = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion,
        CurrentHorizontalResolution, CurrentVerticalResolution)
      GraphicsConfig = @(Get-RegTree 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\Configuration')
      Intel = @(Get-RegTree 'HKLM:\SOFTWARE\Intel\Display')
    }
  }
  Save-Json 'umd-tools' {
    Get-ExistingPaths @('C:\Program Files', 'C:\Program Files (x86)', 'C:\Boeing') | Get-ChildItem -Directory -Recurse -Depth 2 `
      -ErrorAction SilentlyContinue | Where-Object Name -match '(?i)umd|conformance' |
      ForEach-Object { [pscustomobject]@{ Dir = $_.FullName
        Exes = @(Get-ChildItem $_.FullName -Filter *.exe -ErrorAction SilentlyContinue).Name } }
  }
  Save-Json 'sccm' {
    [pscustomobject]@{
      Programs = @(Get-CimInstance -Namespace root\ccm\ClientSDK -ClassName CCM_Program -ErrorAction SilentlyContinue |
        Select-Object PackageID, ProgramID, Name, EvaluationState, LastRunStatus, LastRunTime)
      Applications = @(Get-CimInstance -Namespace root\ccm\ClientSDK -ClassName CCM_Application -ErrorAction SilentlyContinue |
        Select-Object Id, Name, SoftwareVersion, InstallState)
    }
  }

  # ---------- S3 hardware ----------
  Save-Json 'disks' {
    [pscustomobject]@{
      Disk = @(Get-Disk | Select-Object Number, FriendlyName, SerialNumber, Size, BusType, PartitionStyle,
        NumberOfPartitions, IsBoot, IsSystem, IsOffline, OperationalStatus, HealthStatus, FirmwareVersion)
      Physical = @(Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, MediaType, BusType, HealthStatus, Size)
      Reliability = @(Get-PhysicalDisk | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue |
        Select-Object DeviceId, Temperature, ReadErrorsUncorrected, WriteErrorsUncorrected, Wear)
      DiskDrive = @(Get-CimInstance Win32_DiskDrive | Select-Object Index, Model, Status, ConfigManagerErrorCode,
        InterfaceType, Size, PNPDeviceID)
      PredictFailure = @(Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus `
        -ErrorAction SilentlyContinue | Select-Object InstanceName, PredictFailure, Reason)
      Volumes = @(Get-Volume | Select-Object DriveLetter, FileSystemLabel, FileSystem, Size, SizeRemaining, HealthStatus)
      Events24h = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 7, 11, 51, 129, 153
        StartTime = (Get-Date).AddDays(-1) } -MaxEvents 50 -ErrorAction SilentlyContinue |
        Select-Object TimeCreated, Id, ProviderName, Message)
    }
  }
  Save-Text 'wwan-netsh' {
    '### interfaces'; & netsh.exe mbn show interfaces
    '### readyinfo'; & netsh.exe mbn show readyinfo interface=*
    '### profiles'; & netsh.exe mbn show profiles
    '### slotmapping'; & netsh.exe mbn show slotmapping interface=*
    '### connection'; & netsh.exe mbn show connection interface=*
  }
  Save-Json 'wwan-registry' { Get-RegTree 'HKLM:\SOFTWARE\Microsoft\WwanSvc' }
  Save-Json 'network' {
    $adapters = Get-NetAdapter | Select-Object Name, InterfaceDescription, Status, MediaType, LinkSpeed
    $wwanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.InterfaceAlias -match '(?i)cellular|mobile|wwan' } | Select-Object -First 1).IPAddress
    $code = $null
    if ($wwanIp) {
      $code = & curl.exe --interface $wwanIp -sS -o NUL -w '%{http_code}' --max-time 20 https://myboeingfleet.com 2>&1
    }
    [pscustomobject]@{ Adapters = @($adapters); WwanIp = $wwanIp; MyBoeingFleetViaWwan = "$code"
      OnAC = @(Get-CimInstance Win32_Battery | Select-Object -ExpandProperty BatteryStatus) }
  }

  # ---------- S4 bios ----------
  Save-Json 'bios' {
    $sb = $null; try { $sb = Confirm-SecureBootUEFI } catch { $sb = "error: $($_.Exception.Message)" }
    [pscustomobject]@{
      SecureBoot = $sb
      RootNamespaces = @(Get-CimInstance -Namespace root -ClassName __NAMESPACE | Select-Object -ExpandProperty Name)
      WmiBiosClasses = @(Get-CimClass -Namespace root\wmi -ErrorAction SilentlyContinue |
        Where-Object CimClassName -match '(?i)pana|bios' | Select-Object -ExpandProperty CimClassName)
      Bluetooth = @(Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue |
        Select-Object FriendlyName, Status)
      Touch = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object FriendlyName -match '(?i)touch' | Select-Object Class, FriendlyName, Status)
    }
  }
  Save-Text 'firmware-boot' { & bcdedit.exe /enum firmware }
}
finally {
  if ($hiveLoaded) { [gc]::Collect(); Start-Sleep -Milliseconds 500; & reg.exe unload 'HKU\PreflightProbe' | Out-Null }
}

# ---------- summary ----------
$summary = Join-Path $Out 'SUMMARY.txt'
try {
  $id = Get-Content (Join-Path $Out 'identity.json') -Raw | ConvertFrom-Json
  $os = Get-Content (Join-Path $Out 'os.json') -Raw | ConvertFrom-Json
  $dk = Get-Content (Join-Path $Out 'disks.json') -Raw | ConvertFrom-Json
  $lines = @(
    "Label      : $Label  ($stamp)"
    "Model/SKU  : $($id.Model) / $($id.SystemSKU)"
    "Serial     : $($id.Serial)    AssetTag: $($id.AssetTag)"
    "BIOS       : $($id.BiosVersion)"
    "OS         : $($os.ProductName) $($os.DisplayVersion) build $($os.CurrentBuild).$($os.UBR)"
    "Disks      :"
  )
  foreach ($d in $dk.Disk) {
    $lines += ('  #{0} {1} {2:N2} TB {3} {4} boot={5} health={6}' -f $d.Number, $d.FriendlyName, ($d.Size / 1e12),
      $d.BusType, $d.PartitionStyle, $d.IsBoot, $d.HealthStatus)
  }
  $lines | Out-File $summary -Encoding utf8
} catch { "summary failed: $($_.Exception.Message)" | Out-File $summary -Encoding utf8 }

$zip = "$Out.probe.zip"
Compress-Archive -Path "$Out\*" -DestinationPath $zip -Force
Get-Content $summary
Write-Host "`nDone. Folder: $Out`nZip:    $zip" -ForegroundColor Green
