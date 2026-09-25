# os.build / os.patch: Windows build and cumulative update (UBR).
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    $build = "$($cv.CurrentBuild)"
    $ubr = [int]$cv.UBR
    $ev = @{ product = $cv.ProductName; displayVersion = $cv.DisplayVersion; build = $build; ubr = $ubr }
    $actualFull = "$build.$ubr"
    if ($null -ne $P.build) {
        if (Test-Tbd $P.build) { Out-Result needs_human -Actual $actualFull -Evidence $ev }
        if ($build -eq "$($P.build)") { Out-Result pass -Expected "$($P.build)" -Actual $actualFull -Evidence $ev }
        Out-Result fail -Expected "$($P.build)" -Actual $actualFull -Evidence $ev
    }
    if ((Test-Tbd $P.minUbr) -or [int]$P.minUbr -le 0) { Out-Result needs_human -Actual "UBR $ubr" -Evidence $ev }
    if ($ubr -ge [int]$P.minUbr) { Out-Result pass -Expected "UBR >= $($P.minUbr)" -Actual "UBR $ubr" -Evidence $ev }
    Out-Result fail -Expected "UBR >= $($P.minUbr)" -Actual "UBR $ubr" -Evidence $ev
}
