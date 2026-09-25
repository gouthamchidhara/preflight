# ff.startup-popups: Firefox not enabled at startup for the user, and no Firefox icon on the Public Desktop.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

function Test-Enabled($approved, [string]$name) {
    # StartupApproved: first byte even (02/06) = enabled, odd (03/07) = disabled. No entry = enabled.
    if (-not $approved.ContainsKey($name)) { return $true }
    $hex = "$($approved[$name])"
    if ($hex.Length -lt 2) { return $true }
    return (([Convert]::ToInt32($hex.Substring(0, 2), 16) -band 1) -eq 0)
}
Invoke-Check {
    $pat = $P.namePattern
    # ArrayList: mutated by reference from the nested hive block (+= would create a copy in that scope)
    $enabled = New-Object System.Collections.ArrayList
    $hklmRun = Get-RegValues 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
    $hklmApproved = Get-RegValues 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
    foreach ($k in @($hklmRun.Keys)) { if (($k -match $pat -or "$($hklmRun[$k])" -match $pat) -and (Test-Enabled $hklmApproved $k)) { [void]$enabled.Add("HKLM Run: $k") } }
    Invoke-WithUserHive $P.user {
        param($root)
        $run = Get-RegValues "$root\Software\Microsoft\Windows\CurrentVersion\Run"
        $approved = Get-RegValues "$root\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
        foreach ($k in @($run.Keys)) { if (($k -match $pat -or "$($run[$k])" -match $pat) -and (Test-Enabled $approved $k)) { [void]$enabled.Add("User Run: $k") } }
        $folderApproved = Get-RegValues "$root\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"
        $startup = Join-Path (Get-UserProfilePath $P.user) 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup'
        foreach ($f in @(Get-ChildItem -Path $startup -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $pat })) {
            if (Test-Enabled $folderApproved $f.Name) { [void]$enabled.Add("Startup folder: $($f.Name)") }
        }
    }
    $icons = @(Get-ChildItem 'C:\Users\Public\Desktop' -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -match $pat } | ForEach-Object { $_.Name })
    $issues = @($enabled.ToArray()) + @($icons | ForEach-Object { "Public Desktop icon: $_" })
    if ($issues.Count -eq 0) { Out-Result pass -Expected 'disabled, no desktop icon' -Actual 'disabled, no desktop icon' }
    Out-Result fail -Expected 'disabled, no desktop icon' -Actual ($issues -join '; ') -Evidence @{ issues = $issues }
}
