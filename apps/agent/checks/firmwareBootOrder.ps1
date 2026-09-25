# bios.boot-order: first firmware boot entry is the expected one and no UEFI network (PXE) boot entries exist.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $raw = (& bcdedit.exe /enum firmware 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { Out-Result error -Actual 'bcdedit /enum firmware failed' -Evidence @{ raw = $raw.Trim() } }
    $entries = @{}
    $order = @()
    foreach ($block in ($raw -split "(?:`r?`n){2,}")) {
        $id = [regex]::Match($block, '(?m)^identifier\s+(\{[^}]+\})').Groups[1].Value
        if (-not $id) { continue }
        $entries[$id] = [regex]::Match($block, '(?m)^description\s+(.+?)\s*$').Groups[1].Value
        if ($id -eq '{fwbootmgr}') {
            # displayorder lists one {guid} per line; continuation lines are indented
            $inOrder = $false
            foreach ($l in ($block -split "`r?`n")) {
                if ($l -match '^displayorder\s+(\{[^}]+\})') { $inOrder = $true; $order += $Matches[1]; continue }
                if ($inOrder -and $l -match '^\s+(\{[^}]+\})\s*$') { $order += $Matches[1]; continue }
                $inOrder = $false
            }
        }
    }
    $names = @($order | ForEach-Object { if ($entries.ContainsKey($_)) { $entries[$_] } else { $_ } })
    $pxe = @($names | Where-Object { $_ -match '(?i)pxe|ipv4|ipv6|network|\blan\b' })
    $ev = @{ order = $names }
    $first = if ($names.Count) { $names[0] } else { '(none)' }
    if ($pxe.Count) { Out-Result fail -Expected 'no network boot entries' -Actual ("network boot present: " + ($pxe -join ', ')) -Evidence $ev }
    if (Test-Tbd $P.first) { Out-Result needs_human -Actual "first: $first" -Evidence $ev }
    if ($first -match [regex]::Escape($P.first)) { Out-Result pass -Expected "first: $($P.first)" -Actual "first: $first" -Evidence $ev }
    Out-Result fail -Expected "first: $($P.first)" -Actual "first: $first" -Evidence $ev
}
