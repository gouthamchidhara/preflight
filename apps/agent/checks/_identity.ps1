# Agent identity + telemetry for enroll/checkin. Not a check: prints one JSON object, never fails hard.
. "$PSScriptRoot\_lib.ps1"
$ErrorActionPreference = 'Continue'
function Try-Get([scriptblock]$b, $default) { try { $v = & $b; if ($null -eq $v) { $default } else { $v } } catch { $default } }

$cs = Try-Get { Get-CimInstance Win32_ComputerSystem } $null
$bios = Try-Get { Get-CimInstance Win32_BIOS } $null
$enc = Try-Get { Get-CimInstance Win32_SystemEnclosure } $null
$cv = Try-Get { Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' } $null
$adapters = @(Try-Get { Get-NetAdapter -Physical -ErrorAction Stop } @())
$ac = Try-Get { @(Get-CimInstance -Namespace root\wmi -ClassName BatteryStatus -ErrorAction Stop | Where-Object { $_.PowerOnline }).Count -gt 0 } $null
if ($null -eq $ac) { $ac = Try-Get { @(Get-CimInstance Win32_Battery -ErrorAction Stop | Where-Object { $_.BatteryStatus -eq 2 }).Count -gt 0 } $true }
$wwan = @($adapters | Where-Object { $_.Status -eq 'Up' -and ($_.MediaType -match 'Wireless WAN' -or $_.InterfaceDescription -match '(?i)mobile broadband|wwan|lte|5g') })
$lan = @($adapters | Where-Object { $_.Status -eq 'Up' -and $_.MediaType -eq '802.3' })

$o = [ordered]@{
    hostname  = $env:COMPUTERNAME
    serial    = if ($bios) { "$($bios.SerialNumber)".Trim() } else { '' }
    assetTag  = if ($enc) { "$($enc.SMBIOSAssetTag)".Trim() } else { '' }
    model     = if ($cs) { "$($cs.Model)".Trim() } else { '' }
    osBuild   = if ($cv) { "$($cv.CurrentBuild).$($cv.UBR)" } else { '' }
    onAC      = [bool]$ac
    lanUp     = $lan.Count -gt 0
    wwanReady = $wwan.Count -gt 0
}
Write-Output (ConvertTo-Json -InputObject $o -Compress)
exit 0
