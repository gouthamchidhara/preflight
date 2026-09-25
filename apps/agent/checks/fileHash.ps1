# lsapl.connections / lsapl.truststore: file present, same as its C:\com-code-client source, matches golden.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $path = Expand-PfPath $P.path
    $src = if ($P.source) { Expand-PfPath $P.source } else { $null }
    $srcHash = if ($src -and (Test-Path -LiteralPath $src)) { Get-FileSha256 $src } else { $null }
    $ev = @{ path = $path; source = $src; sourceSha256 = $srcHash }
    $golden = if (Test-Tbd $P.sha256) { $null } else { ConvertTo-HashId $P.sha256 }
    $expected = if ($golden) { $golden } elseif ($srcHash) { $srcHash } else { 'present' }
    if (-not (Test-Path -LiteralPath $path)) { Out-Result fail -Expected $expected -Actual 'file missing' -Evidence $ev }
    $h = Get-FileSha256 $path
    $ev['sourceMatchesGolden'] = if ($golden -and $srcHash) { $srcHash -eq $golden } else { $null }
    if ($golden) {
        if ($h -eq $golden) { Out-Result pass -Expected $golden -Actual $h -Evidence $ev }
        Out-Result fail -Expected $golden -Actual $h -Evidence $ev
    }
    if ($srcHash) {
        if ($h -eq $srcHash) { Out-Result pass -Expected "same as source ($srcHash)" -Actual $h -Evidence $ev }
        Out-Result fail -Expected "same as source ($srcHash)" -Actual $h -Evidence $ev
    }
    Out-Result needs_human -Actual $h -Evidence $ev
}
