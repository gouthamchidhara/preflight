# hw.identity: SMBIOS asset tag matches QJ0681xxxx.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $enc = Get-CimInstance Win32_SystemEnclosure
    $bios = Get-CimInstance Win32_BIOS
    $cs = Get-CimInstance Win32_ComputerSystem
    $tag = "$($enc.SMBIOSAssetTag)".Trim()
    $ev = @{ assetTag = $tag; serial = "$($bios.SerialNumber)".Trim(); model = $cs.Model; sku = $cs.SystemSKUNumber; hostname = $env:COMPUTERNAME }
    $shown = if ($tag) { $tag } else { '(empty)' }
    if (Test-Tbd $P.assetTagPattern) { Out-Result needs_human -Actual $shown -Evidence $ev }
    if ($tag -match $P.assetTagPattern) { Out-Result pass -Expected $P.assetTagPattern -Actual $tag -Evidence $ev }
    Out-Result fail -Expected $P.assetTagPattern -Actual $shown -Evidence $ev
}
