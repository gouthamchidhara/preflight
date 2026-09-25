# umd.conformance: UMD Tools conformance. Needs its CLI or report location (P0-3); until then reports what is installed.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $dirs = @(Get-ExistingPaths @('C:\Program Files', 'C:\Program Files (x86)', 'C:\Boeing') | Get-ChildItem -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '(?i)umd|conformance' } | Select-Object -First 10 | ForEach-Object { $_.FullName })
    Out-Result needs_human -Expected "all green except: $((@($P.allowedWarnings)) -join ', ')" -Actual 'open UMD Tools -> Check Conformance and attest' -Evidence @{ installDirs = $dirs }
}
