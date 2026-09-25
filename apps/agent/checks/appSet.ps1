# app.required-set: every required app is installed at or above its minimum version.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

function ConvertTo-Ver([string]$s) {
    $m = [regex]::Match("$s", '\d+(\.\d+){0,3}')
    if ($m.Success) { try { return [version]$m.Value } catch { } }
    return $null
}
Invoke-Check {
    $apps = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    ) | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } | Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName }
    $req = @($P.required)
    if ((Test-Tbd $P.required) -or $req.Count -eq 0) {
        $names = @($apps | ForEach-Object { "$($_.DisplayName) $($_.DisplayVersion)".Trim() } | Sort-Object -Unique)
        Out-Result needs_human -Actual "$($names.Count) apps installed (required list not captured yet)" -Evidence @{ installed = $names }
    }
    $problems = @()
    foreach ($r in $req) {
        $hit = @($apps | Where-Object { $_.DisplayName -like $r.name })
        if ($hit.Count -eq 0) { $problems += "$($r.name): missing"; continue }
        if ($r.minVersion) {
            $have = ConvertTo-Ver $hit[0].DisplayVersion
            $want = ConvertTo-Ver $r.minVersion
            if ($want -and (-not $have -or $have -lt $want)) { $problems += "$($r.name): $($hit[0].DisplayVersion) < $($r.minVersion)" }
        }
    }
    if ($problems.Count -eq 0) { Out-Result pass -Expected "$($req.Count) apps" -Actual 'all present' }
    Out-Result fail -Expected "$($req.Count) apps" -Actual "$($problems.Count) problem(s)" -Evidence @{ problems = $problems }
}
