# disk.os-health: OS disk healthy and enough free space on the system drive.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $boot = Get-Disk | Where-Object { $_.IsBoot } | Select-Object -First 1
    $vol = Get-Volume -DriveLetter ($env:SystemDrive.TrimEnd(':'))
    $freeGb = [math]::Round($vol.SizeRemaining / 1GB, 1)
    $problems = @()
    if ($boot -and "$($boot.HealthStatus)" -ne 'Healthy') { $problems += "OS disk $($boot.HealthStatus)" }
    if ($freeGb -lt [double]$P.minFreeGb) { $problems += "$freeGb GB free" }
    $expected = "Healthy, >= $($P.minFreeGb) GB free"
    $ev = @{ disk = "$($boot.FriendlyName)"; freeGb = $freeGb; sizeGb = [math]::Round($vol.Size / 1GB, 1) }
    if ($problems.Count -eq 0) { Out-Result pass -Expected $expected -Actual "Healthy, $freeGb GB free" -Evidence $ev }
    Out-Result fail -Expected $expected -Actual ($problems -join '; ') -Evidence $ev
}
