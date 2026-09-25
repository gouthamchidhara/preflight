# bios.version: BIOS matches the current release for this model variant (touch / non-touch).
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $bios = Get-CimInstance Win32_BIOS
    $cs = Get-CimInstance Win32_ComputerSystem
    $have = "$($bios.SMBIOSBIOSVersion)".Trim()
    $ev = @{ model = $cs.Model; sku = $cs.SystemSKUNumber; releaseDate = "$($bios.ReleaseDate)" }
    $known = @{}
    foreach ($prop in $P.versions.PSObject.Properties) { if (-not (Test-Tbd $prop.Value)) { $known[$prop.Name] = "$($prop.Value)" } }
    if ($known.Count -eq 0) { Out-Result needs_human -Actual $have -Evidence $ev }
    $variant = $null
    if (-not (Test-Tbd $P.touchSkuPattern)) { $variant = if ("$($cs.SystemSKUNumber) $($cs.Model)" -match $P.touchSkuPattern) { 'touch' } else { 'nontouch' } }
    $ev['variant'] = $variant
    if ($variant -and $known.ContainsKey($variant)) {
        if ($have -eq $known[$variant]) { Out-Result pass -Expected $known[$variant] -Actual $have -Evidence $ev }
        Out-Result fail -Expected "$($known[$variant]) ($variant)" -Actual $have -Evidence $ev
    }
    # Variant unknown: any current release is acceptable (the touch package cannot install on non-touch units).
    if ($known.Values -contains $have) { Out-Result pass -Expected ($known.Values -join ' or ') -Actual $have -Evidence $ev }
    Out-Result fail -Expected ($known.Values -join ' or ') -Actual $have -Evidence $ev
}
