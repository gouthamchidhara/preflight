# ui.desktop-icons / tbx.shortcuts: expected desktop shortcuts exist and point at something real.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $dirs = @('C:\Users\Public\Desktop', (Join-Path (Get-UserProfilePath $P.user) 'Desktop'))
    $sh = New-Object -ComObject WScript.Shell
    $found = @{}
    foreach ($d in $dirs) {
        if (-not (Test-Path $d)) { continue }
        foreach ($f in (Get-ChildItem -Path $d -Force -File | Where-Object { $_.Extension -in '.lnk', '.url', '.appref-ms' })) {
            $target = ''
            if ($f.Extension -eq '.lnk') { $target = $sh.CreateShortcut($f.FullName).TargetPath }
            $ok = (-not $target) -or (Test-Path -LiteralPath $target)
            $found[$f.BaseName.ToLower()] = @{ name = $f.BaseName; target = $target; targetOk = $ok }
        }
    }
    $names = @($found.Values | ForEach-Object { $_.name } | Sort-Object)
    $icons = @($P.icons)
    if ((Test-Tbd $P.icons) -or $icons.Count -eq 0) { Out-Result needs_human -Actual "$($names.Count) shortcuts on desktop" -Evidence @{ shortcuts = $names } }
    $missing = @(); $broken = @()
    foreach ($i in $icons) {
        $e = $found["$($i.name)".ToLower()]
        if (-not $e) { $missing += $i.name } elseif (-not $e.targetOk) { $broken += "$($i.name) -> $($e.target)" }
    }
    $ev = @{ missing = $missing; brokenTargets = $broken; onDesktop = $names }
    if ($missing.Count -eq 0 -and $broken.Count -eq 0) { Out-Result pass -Expected "$($icons.Count) shortcuts" -Actual "$($icons.Count) present" -Evidence $ev }
    Out-Result fail -Expected "$($icons.Count) shortcuts" -Actual "$($missing.Count) missing, $($broken.Count) broken" -Evidence $ev
}
