# tbx.files-current: Toolbox Remote 787 set is complete (index, Part_1..N, Setup), one build stamp, new enough. Names and sizes only; ~12 GB is never hashed.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $dir = $P.dir
    if (-not (Test-Path $dir)) { Out-Result fail -Expected 'Toolbox files' -Actual "folder missing: $dir" }
    $files = @(Get-ChildItem -Path $dir -File -Force)
    $re = '^Offline_AAL_HTML5-FULL_(\d{14})_F_(index|Setup|Part_(\d+)_of_(\d+))'
    $sets = @{}
    foreach ($f in $files) {
        $m = [regex]::Match($f.Name, $re)
        if (-not $m.Success) { continue }
        $stamp = $m.Groups[1].Value
        if (-not $sets.ContainsKey($stamp)) { $sets[$stamp] = @() }
        $sets[$stamp] += $f
    }
    $ev = @{ stamps = @($sets.Keys | Sort-Object); hasDeploy = (Test-Path (Join-Path $dir 'deploy')) }
    if ($sets.Count -eq 0) { Out-Result fail -Expected 'Offline_AAL_HTML5-FULL_* set' -Actual 'no Toolbox files found' -Evidence $ev }
    $stamp = @($sets.Keys | Sort-Object)[-1]
    $set = $sets[$stamp]
    $parts = if (Test-Tbd $P.parts) { 0 } else { [int]$P.parts }
    if ($parts -le 0) {
        $of = [regex]::Match(($set | ForEach-Object { $_.Name }) -join ' ', '_of_(\d+)')
        $parts = if ($of.Success) { [int]$of.Groups[1].Value } else { 0 }
    }
    $missing = @()
    if (-not ($set | Where-Object { $_.Name -match '_F_index' })) { $missing += 'index' }
    if (-not ($set | Where-Object { $_.Name -match '_F_Setup' })) { $missing += 'Setup' }
    for ($i = 1; $i -le $parts; $i++) { if (-not ($set | Where-Object { $_.Name -match "_F_Part_$($i)_of_" })) { $missing += "Part_$i" } }
    $empty = @($set | Where-Object { $_.Length -eq 0 } | ForEach-Object { $_.Name })
    $partial = @($files | Where-Object { $_.Extension -in '.tmp', '.partial', '.crdownload' } | ForEach-Object { $_.Name })
    $ev['stamp'] = $stamp; $ev['missing'] = $missing; $ev['zeroBytes'] = $empty; $ev['partial'] = $partial
    $ev['totalGB'] = [math]::Round((($set | Measure-Object -Property Length -Sum).Sum / 1GB), 2)
    $problems = @()
    if ($missing.Count) { $problems += "missing $($missing -join ',')" }
    if ($empty.Count) { $problems += "$($empty.Count) empty file(s)" }
    if ($partial.Count) { $problems += "download in progress" }
    if (-not $ev.hasDeploy) { $problems += 'no deploy folder' }
    $expected = if (Test-Tbd $P.minStamp) { "complete set" } else { "stamp >= $($P.minStamp), complete set" }
    if (-not (Test-Tbd $P.minStamp) -and $stamp -lt "$($P.minStamp)") { $problems += "stamp $stamp older than $($P.minStamp)" }
    if ($problems.Count) { Out-Result fail -Expected $expected -Actual ($problems -join '; ') -Evidence $ev }
    Out-Result pass -Expected $expected -Actual "$stamp, $parts/$parts parts" -Evidence $ev
}
