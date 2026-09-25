# lsapl.log: newest LSAPL logs contain none of the known error signatures.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    if (-not (Test-Path $P.dir)) { Out-Result skip -Actual "folder missing: $($P.dir)" }
    $logs = @(Get-ChildItem -Path $P.dir -Recurse -Include *.log -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3)
    if ($logs.Count -eq 0) { Out-Result pass -Expected 'no known errors' -Actual 'no log files yet' }
    $files = @($logs | ForEach-Object { "$($_.FullName) ($($_.LastWriteTime))" })
    $pats = @($P.patterns)
    if ((Test-Tbd $P.patterns) -or $pats.Count -eq 0) {
        $recent = @($logs | ForEach-Object { Get-Content -Path $_.FullName -Tail 2000 -ErrorAction SilentlyContinue } | Where-Object { $_ -match '(?i)error|exception|fail' } | Select-Object -Last 8)
        Out-Result needs_human -Actual "$($recent.Count) recent error-looking line(s); signatures not captured yet" -Evidence @{ files = $files; recent = $recent }
    }
    $hits = @()
    foreach ($l in $logs) {
        foreach ($line in (Get-Content -Path $l.FullName -Tail 2000 -ErrorAction SilentlyContinue)) {
            foreach ($p in $pats) { if ($line -like "*$p*") { $hits += $line; break } }
        }
    }
    if ($hits.Count -eq 0) { Out-Result pass -Expected 'no known errors' -Actual 'none' -Evidence @{ files = $files } }
    Out-Result fail -Expected 'no known errors' -Actual "$($hits.Count) matching line(s)" -Evidence @{ files = $files; lines = @($hits | Select-Object -Last 10) }
}
