# lsapl.backend: every host:port named in connections.properties accepts TCP (proxy for "Connected to Ground Network").
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    if (-not (Test-Path -LiteralPath $P.path)) { Out-Result skip -Actual 'connections.properties missing (see lsapl.connections)' }
    $targets = @{}
    foreach ($kv in (Read-Properties $P.path).GetEnumerator()) {
        foreach ($m in [regex]::Matches("$($kv.Value)", '(?i)\b(https?|ldaps?|tcp|ssl|jdbc:[a-z]+)://([A-Za-z0-9.-]+)(?::(\d+))?')) {
            $scheme = $m.Groups[1].Value.ToLower()
            $port = if ($m.Groups[3].Success) { [int]$m.Groups[3].Value } elseif ($scheme -eq 'http') { 80 } elseif ($scheme -like 'ldap*') { 636 } else { 443 }
            $targets["$($m.Groups[2].Value):$port"] = @($m.Groups[2].Value, $port)
        }
        $hp = [regex]::Match("$($kv.Value)", '^([A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+):(\d{2,5})$')
        if ($hp.Success) { $targets["$($hp.Groups[1].Value):$($hp.Groups[3].Value)"] = @($hp.Groups[1].Value, [int]$hp.Groups[3].Value) }
    }
    if ($targets.Count -eq 0) { Out-Result needs_human -Actual 'no host:port found in connections.properties' }
    $results = @{}; $down = @()
    foreach ($t in @($targets.Keys | Sort-Object | Select-Object -First 10)) {
        $r = Test-TcpPort $targets[$t][0] $targets[$t][1] ([int]$P.timeoutMs)
        $results[$t] = $r
        if ($r -ne 'open') { $down += "$t ($r)" }
    }
    if ($down.Count -eq 0) { Out-Result pass -Expected 'all reachable' -Actual "$($results.Count) reachable" -Evidence @{ targets = $results } }
    Out-Result fail -Expected 'all reachable' -Actual ($down -join '; ') -Evidence @{ targets = $results }
}
