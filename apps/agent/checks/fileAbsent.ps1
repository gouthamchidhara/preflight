# lsapl.airwall-icon: no file matching a pattern in the given folders.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $hits = @()
    foreach ($d in @($P.dirs)) {
        $dir = Expand-PfPath $d
        if (Test-Path $dir) { $hits += @(Get-ChildItem -Path $dir -Filter $P.pattern -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
    }
    if ($hits.Count -eq 0) { Out-Result pass -Expected 'absent' -Actual 'absent' }
    Out-Result fail -Expected 'absent' -Actual ($hits -join '; ') -Evidence @{ files = $hits }
}
