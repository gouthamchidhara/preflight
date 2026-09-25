# app.intel-gcc: an Appx package (e.g. Intel Graphics Command Center) is installed.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $pkgs = @(Get-AppxPackage -AllUsers -Name $P.name -ErrorAction SilentlyContinue)
    if ($pkgs.Count -gt 0) {
        Out-Result pass -Expected 'installed' -Actual "$($pkgs[0].Name) $($pkgs[0].Version)" -Evidence @{ packages = @($pkgs | ForEach-Object { "$($_.Name) $($_.Version)" }) }
    }
    $prov = @(Get-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like $P.name })
    if ($prov.Count -gt 0) { Out-Result pass -Expected 'installed' -Actual "provisioned: $($prov[0].DisplayName) $($prov[0].Version)" }
    Out-Result fail -Expected 'installed' -Actual 'not installed'
}
