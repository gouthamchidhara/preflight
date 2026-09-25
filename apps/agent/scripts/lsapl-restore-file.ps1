# lsapl-restore-file: copy connections.properties or the trust store from C:\com-code-client into LSAPL.
# Fix script (PLAN.md §7): prints what it did, exit 0 = success. Backs up before changing anything.
. "$PSScriptRoot\..\checks\_lib.ps1"
$P = Get-Params

$map = @{
    connections = @('C:\com-code-client\connections.properties', 'C:\Boeing\LSAPL-SMT\App\conf\connections.properties')
    truststore  = @('C:\com-code-client\ee-prod-smt-trust.jks', 'C:\Boeing\LSAPL-SMT\Keys\ee-prod-smt-trust.jks')
}
if (-not $map.ContainsKey("$($P.file)")) { Write-Error "unknown file '$($P.file)'"; exit 2 }
$src, $dst = $map["$($P.file)"]
if (-not (Test-Path -LiteralPath $src)) { Write-Error "source missing: $src"; exit 3 }
if (Test-Path -LiteralPath $dst) {
    Copy-Item -LiteralPath $dst -Destination (Join-Path $P.backupDir (Split-Path $dst -Leaf)) -Force
    Write-Output "backed up $dst"
}
New-Item -ItemType Directory -Path (Split-Path $dst -Parent) -Force | Out-Null
Copy-Item -LiteralPath $src -Destination $dst -Force
if ((Get-FileSha256 $src) -ne (Get-FileSha256 $dst)) { Write-Error 'copy verification failed'; exit 4 }
Write-Output "restored $dst from $src"
exit 0
