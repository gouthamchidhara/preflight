# net.ground: a host:port on the ground network accepts TCP.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    if (Test-Tbd $P.host) { Out-Result needs_human -Actual 'ground-network host not configured yet (P0-2)' }
    $r = Test-TcpPort $P.host ([int]$P.port) 5000
    if ($r -eq 'open') { Out-Result pass -Expected "$($P.host):$($P.port) open" -Actual 'open' }
    Out-Result fail -Expected "$($P.host):$($P.port) open" -Actual $r
}
