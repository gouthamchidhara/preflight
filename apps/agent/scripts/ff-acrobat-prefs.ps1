# ff-acrobat-prefs: set pdfjs.disabled=true and plugin.state.nppdf32=2 in user.js of the Toolbox Firefox profile(s).
# Fix script (PLAN.md §7): prints what it did, exit 0 = success. Backs up before changing anything.
. "$PSScriptRoot\..\checks\_lib.ps1"
$P = Get-Params

if (@(Get-Process -Name firefox -ErrorAction SilentlyContinue).Count -gt 0) { Write-Error 'Firefox is running. Close it and run the fix again.'; exit 5 }
$golden = @{}
$gp = Join-Path $PSScriptRoot '..\golden.json'
if (Test-Path $gp) { $golden = Get-Content $gp -Raw | ConvertFrom-Json }
$dirs = @(Get-FirefoxProfileDirs 'Mechanic' $golden.'ff.profileDir')
if ($dirs.Count -eq 0) { Write-Error 'no Firefox profile found'; exit 3 }
$want = [ordered]@{ 'pdfjs.disabled' = 'true'; 'plugin.state.nppdf32' = '2' }
foreach ($d in $dirs) {
    $userJs = Join-Path $d 'user.js'
    $lines = @()
    if (Test-Path $userJs) {
        Copy-Item $userJs (Join-Path $P.backupDir ("user.js." + ($d -replace '[:\\ ]', '_'))) -Force
        $lines = @(Get-Content $userJs | Where-Object { $l = $_; -not ($want.Keys | Where-Object { $l -match ('user_pref\("' + [regex]::Escape($_) + '"') }) })
    }
    foreach ($k in $want.Keys) { $lines += "user_pref(""$k"", $($want[$k]));" }
    Set-Content -Path $userJs -Value $lines -Encoding ASCII
    Write-Output "updated $userJs"
}
exit 0
