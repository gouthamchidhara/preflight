# bios.settings: Power On AC, Concealed Mode, Password on Boot, supervisor password. Needs Panasonic BIOS WMI (P0-1); until then asks a human.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $classes = @(Get-CimClass -Namespace root\wmi -ErrorAction SilentlyContinue | Where-Object { $_.CimClassName -match '(?i)pana' } | ForEach-Object { $_.CimClassName })
    $actual = if ($classes.Count) { "Panasonic WMI classes found ($($classes.Count)); mapping not built yet" } else { 'Panasonic BIOS WMI not available' }
    Out-Result needs_human -Expected 'Power On AC=Enabled, Concealed=Disabled, Password on Boot=Disabled, supervisor pw set' -Actual $actual -Evidence @{ classes = $classes }
}
