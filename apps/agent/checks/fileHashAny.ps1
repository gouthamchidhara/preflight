# ui.wallpaper: some file in a folder matches a golden hash (AA background in CachedFiles).
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $dir = Expand-PfPath $P.dir
    if (-not (Test-Path $dir)) { Out-Result fail -Expected 'AA background' -Actual "folder missing: $dir" }
    $files = @(Get-ChildItem -Path $dir -File -Force -ErrorAction SilentlyContinue | ForEach-Object { @{ name = $_.Name; sha256 = (Get-FileSha256 $_.FullName) } })
    if ($files.Count -eq 0) { Out-Result fail -Expected 'AA background' -Actual 'no cached wallpaper' }
    if (Test-Tbd $P.sha256) { Out-Result needs_human -Actual $files[0].sha256 -Evidence @{ files = $files } }
    $want = ConvertTo-HashId $P.sha256
    if (@($files | Where-Object { $_.sha256 -eq $want }).Count -gt 0) { Out-Result pass -Expected $want -Actual 'match' }
    Out-Result fail -Expected $want -Actual $files[0].sha256 -Evidence @{ files = $files }
}
