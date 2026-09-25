# bios.bluetooth-off / bios.touch-off: device class/name is not enumerated (disabled in BIOS devices disappear from Windows).
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $devs = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue)
    if ($P.class) { $devs = @($devs | Where-Object { $_.Class -eq $P.class }) }
    if ($P.namePattern) { $devs = @($devs | Where-Object { $_.FriendlyName -match $P.namePattern }) }
    if ($devs.Count -eq 0) { Out-Result pass -Expected 'not present' -Actual 'not present' }
    $names = @($devs | ForEach-Object { "$($_.FriendlyName) [$($_.Status)]" } | Select-Object -Unique)
    Out-Result fail -Expected 'not present' -Actual ($names -join '; ') -Evidence @{ devices = $names }
}
