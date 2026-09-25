# sccm.pkg-12650: the sign-out fix package shows as installed in the SCCM client.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    try {
        $progs = @(Get-CimInstance -Namespace root\ccm\ClientSDK -ClassName CCM_Program -ErrorAction Stop)
    }
    catch { Out-Result needs_human -Actual 'SCCM client SDK not available' -Evidence @{ error = $_.Exception.Message } }
    $apps = @(Get-CimInstance -Namespace root\ccm\ClientSDK -ClassName CCM_Application -ErrorAction SilentlyContinue)
    $m = "$($P.match)"
    $hitP = @($progs | Where-Object { "$($_.PackageID) $($_.ProgramID) $($_.Name)" -match [regex]::Escape($m) })
    $hitA = @($apps | Where-Object { "$($_.Id) $($_.Name)" -match [regex]::Escape($m) })
    $ev = @{
        programs = @($hitP | ForEach-Object { "$($_.PackageID)/$($_.ProgramID) $($_.Name): state=$($_.EvaluationState) last=$($_.LastRunStatus)" })
        applications = @($hitA | ForEach-Object { "$($_.Name): $($_.InstallState)" })
    }
    if (@($hitA | Where-Object { $_.InstallState -eq 'Installed' }).Count -gt 0) { Out-Result pass -Expected 'installed' -Actual 'installed' -Evidence $ev }
    if (@($hitP | Where-Object { "$($_.LastRunStatus)" -match '(?i)succe' }).Count -gt 0) { Out-Result pass -Expected 'installed' -Actual 'last run succeeded' -Evidence $ev }
    if ($hitP.Count + $hitA.Count -eq 0) { Out-Result needs_human -Expected 'installed' -Actual "no Software Center item matching '$m'" -Evidence $ev }
    Out-Result needs_human -Expected 'installed' -Actual 'found, state unclear (confirm in Software Center)' -Evidence $ev
}
