# gpo.applied: required computer GPOs are applied (gpresult XML).
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $tmp = Join-Path $env:TEMP "pf-gpresult-$PID.xml"
    try {
        & gpresult.exe /scope computer /x $tmp /f 2>&1 | Out-Null
        if (-not (Test-Path $tmp)) { Out-Result error -Actual "gpresult produced no report (exit $LASTEXITCODE)" }
        [xml]$x = Get-Content -Path $tmp -Raw
    }
    finally { Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue }
    $applied = @()
    foreach ($g in @($x.Rsop.ComputerResults.GPO)) {
        if ($null -eq $g) { continue }
        if ("$($g.Enabled)" -eq 'true' -and "$($g.FilterAllowed)" -ne 'false' -and "$($g.AccessDenied)" -ne 'true') { $applied += "$($g.Name)" }
    }
    $applied = @($applied | Sort-Object -Unique)
    $req = @($P.required)
    if ((Test-Tbd $P.required) -or $req.Count -eq 0) { Out-Result needs_human -Actual "$($applied.Count) GPOs applied" -Evidence @{ applied = $applied } }
    $missing = @($req | Where-Object { $applied -notcontains $_ })
    if ($missing.Count -eq 0) { Out-Result pass -Expected "$($req.Count) required" -Actual 'all applied' -Evidence @{ applied = $applied } }
    Out-Result fail -Expected "$($req.Count) required" -Actual ("missing: " + ($missing -join ', ')) -Evidence @{ applied = $applied }
}
