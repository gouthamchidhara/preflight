# lsapl.app-props: selected .properties values match golden SHA-256 hashes. Raw values are never output.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    if (-not (Test-Path -LiteralPath $P.path)) { Out-Result fail -Expected 'file present' -Actual "missing: $($P.path)" }
    $props = Read-Properties $P.path
    $keys = @($P.keyHashes.PSObject.Properties | ForEach-Object { $_.Name })
    $bad = @(); $tbd = @(); $hashes = @{}
    foreach ($k in $keys) {
        $want = $P.keyHashes.$k
        if (-not $props.Contains($k)) { $bad += "$k missing"; continue }
        $h = Get-Sha256Text $props[$k]
        if (Test-Tbd $want) { $tbd += $k; $hashes[$k] = $h; continue }
        if ($h -ne (ConvertTo-HashId $want)) { $bad += "$k differs" }
    }
    $expected = "$($keys.Count) key hashes match"
    if ($bad.Count) { Out-Result fail -Expected $expected -Actual ($bad -join '; ') }
    if ($tbd.Count) { Out-Result needs_human -Expected $expected -Actual "golden hash not captured for: $($tbd -join ', ')" -Evidence @{ hashes = $hashes } }
    Out-Result pass -Expected $expected -Actual 'all match'
}
