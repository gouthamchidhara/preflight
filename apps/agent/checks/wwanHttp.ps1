# cell.myboeingfleet: HTTPS reachable over the cellular interface (curl bound to the WWAN IP).
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $wwan = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
            $_.Status -eq 'Up' -and ($_.MediaType -match 'Wireless WAN' -or $_.InterfaceDescription -match '(?i)mobile broadband|wwan|lte|5g|cellular' -or $_.Name -match '(?i)cellular') })
    if ($wwan.Count -eq 0) { Out-Result skip -Expected 'HTTP 2xx/3xx via WWAN' -Actual 'WWAN not connected' }
    $ip = (Get-NetIPAddress -InterfaceIndex $wwan[0].ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
    if (-not $ip) { Out-Result skip -Expected 'HTTP 2xx/3xx via WWAN' -Actual 'WWAN has no IPv4 address' }
    $code = (& curl.exe --interface $ip -sS -o NUL -w '%{http_code}' --max-time 25 $P.url 2>&1 | Out-String).Trim()
    $ev = @{ interface = $wwan[0].Name; sourceIp = $ip; url = $P.url }
    if ($code -match '^[23]\d\d$') { Out-Result pass -Expected 'HTTP 2xx/3xx via WWAN' -Actual "HTTP $code" -Evidence $ev }
    Out-Result fail -Expected 'HTTP 2xx/3xx via WWAN' -Actual "$code" -Evidence $ev
}
