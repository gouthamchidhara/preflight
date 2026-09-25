# wallpaper-restore: copy the AA background from the NAS into Mechanic CachedFiles (applies at next sign-in).
# Fix script (PLAN.md §7): prints what it did, exit 0 = success. Backs up before changing anything.
. "$PSScriptRoot\..\checks\_lib.ps1"
$P = Get-Params

$golden = @{}
$gp = Join-Path $PSScriptRoot '..\golden.json'
if (Test-Path $gp) { $golden = Get-Content $gp -Raw | ConvertFrom-Json }
$nas = $golden.'nas.wallpaperDir'
if (Test-Tbd $nas) { Write-Error 'NAS wallpaper folder not configured yet (golden nas.wallpaperDir, P0-5)'; exit 3 }
if (-not (Test-Path -LiteralPath $nas)) { Write-Error "cannot read $nas as the computer account (check NAS ACL, P0-5)"; exit 4 }
$img = Get-ChildItem -LiteralPath $nas -File | Where-Object { $_.Extension -match '(?i)\.(jpg|jpeg|png|bmp)$' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $img) { Write-Error "no image in $nas"; exit 4 }
$dst = Join-Path (Get-UserProfilePath 'Mechanic') 'AppData\Roaming\Microsoft\Windows\Themes\CachedFiles'
New-Item -ItemType Directory -Path $dst -Force | Out-Null
foreach ($f in @(Get-ChildItem -Path $dst -File -ErrorAction SilentlyContinue)) {
    Copy-Item $f.FullName (Join-Path $P.backupDir $f.Name) -Force
}
$existing = @(Get-ChildItem -Path $dst -File -ErrorAction SilentlyContinue | Select-Object -First 1)
$target = if ($existing.Count) { $existing[0].FullName } else { Join-Path $dst $img.Name }
Copy-Item -LiteralPath $img.FullName -Destination $target -Force
Write-Output "copied $($img.Name) to $target (takes effect at next sign-in)"
exit 0
