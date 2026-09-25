# lsapl.airwall-agent: a Windows service (by exact name, else by name pattern) is running.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $svc = @()
    if (-not (Test-Tbd $P.name)) { $svc = @(Get-Service -Name $P.name -ErrorAction SilentlyContinue) }
    if ($svc.Count -eq 0 -and $P.pattern) { $svc = @(Get-Service | Where-Object { $_.Name -match $P.pattern -or $_.DisplayName -match $P.pattern }) }
    $label = if (Test-Tbd $P.name) { "service matching '$($P.pattern)'" } else { $P.name }
    if ($svc.Count -eq 0) { Out-Result fail -Expected "$label running" -Actual 'not installed' }
    $ev = @{ services = @($svc | ForEach-Object { "$($_.Name) ($($_.DisplayName)): $($_.Status)" }) }
    if (@($svc | Where-Object { $_.Status -eq 'Running' }).Count -gt 0) { Out-Result pass -Expected "$label running" -Actual 'running' -Evidence $ev }
    Out-Result fail -Expected "$label running" -Actual "$($svc[0].Status)" -Evidence $ev
}
