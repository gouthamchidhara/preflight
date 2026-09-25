# cell.apn: a mobile broadband profile with APN 32871.fn (AA FirstNet) exists.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $want = $P.apn
    $ifaces = @([regex]::Matches((& netsh.exe mbn show interfaces 2>&1 | Out-String), '(?im)^\s*Name\s*:\s*(.+?)\s*$') | ForEach-Object { $_.Groups[1].Value })
    if ($ifaces.Count -eq 0) { Out-Result skip -Actual 'no WWAN interface' }
    $found = @()
    foreach ($i in $ifaces) {
        $list = (& netsh.exe mbn show profiles interface="$i" 2>&1 | Out-String)
        $names = @(($list -split "`r?`n") | Where-Object { $_ -match '^\s{2,}\S' -and $_ -notmatch ':' } | ForEach-Object { $_.Trim() })
        foreach ($n in $names) {
            $xml = (& netsh.exe mbn show profiles name="$n" interface="$i" 2>&1 | Out-String)
            $apn = [regex]::Match($xml, '<AccessString>(.*?)</AccessString>').Groups[1].Value
            $found += @{ interface = $i; name = $n; apn = $apn }
        }
    }
    $expected = "$($want.profileName) / $($want.apn)"
    $ev = @{ profiles = @($found | ForEach-Object { "$($_.name) / $($_.apn)" }) }
    if (@($found | Where-Object { $_.apn -eq $want.apn }).Count -gt 0) { Out-Result pass -Expected $expected -Actual $expected -Evidence $ev }
    $actual = if ($found.Count) { ($ev.profiles -join '; ') } else { 'no profiles' }
    Out-Result fail -Expected $expected -Actual $actual -Evidence $ev
}
