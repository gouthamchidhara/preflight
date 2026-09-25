# ui.display: resolution 1920x1080 (scaling mode verified once its registry key is known, P0-6).
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $vc = @(Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution })
    $modes = @($vc | ForEach-Object { "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution) ($($_.Name))" })
    $want = "$($P.width)x$($P.height)"
    $ok = @($vc | Where-Object { $_.CurrentHorizontalResolution -eq [int]$P.width -and $_.CurrentVerticalResolution -eq [int]$P.height }).Count -gt 0
    $actual = if ($modes.Count) { $modes -join '; ' } else { 'no active display (headless?)' }
    if (-not $ok) { Out-Result fail -Expected $want -Actual $actual -Evidence @{ modes = $modes } }
    if (Test-Tbd $P.scaling) { Out-Result needs_human -Expected "$want, scaling Stretched" -Actual "$actual; scaling not verified yet" -Evidence @{ modes = $modes } }
    Out-Result pass -Expected $want -Actual $actual
}
