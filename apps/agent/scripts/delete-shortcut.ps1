# delete-shortcut: move matching desktop shortcuts (Airwall) into the backup folder. Reversible.
# Fix script (PLAN.md §7): prints what it did, exit 0 = success. Backs up before changing anything.
. "$PSScriptRoot\..\checks\_lib.ps1"
$P = Get-Params

if ("$($P.pattern)" -ne 'Airwall*.lnk') { Write-Error "pattern not allowed: $($P.pattern)"; exit 2 }
$moved = 0
foreach ($d in @('C:\Users\Public\Desktop', (Join-Path (Get-UserProfilePath 'Mechanic') 'Desktop'))) {
    if (-not (Test-Path $d)) { continue }
    foreach ($f in @(Get-ChildItem -Path $d -Filter $P.pattern -Force -ErrorAction SilentlyContinue)) {
        Move-Item -LiteralPath $f.FullName -Destination (Join-Path $P.backupDir $f.Name) -Force
        Write-Output "moved $($f.FullName) to backup"
        $moved++
    }
}
if ($moved -eq 0) { Write-Output 'nothing to remove' }
exit 0
