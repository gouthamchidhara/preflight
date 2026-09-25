# bios.secureboot: UEFI Secure Boot is on.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    try { $on = Confirm-SecureBootUEFI }
    catch { Out-Result fail -Expected 'On' -Actual ('not supported/readable: ' + $_.Exception.Message) }
    if ($on) { Out-Result pass -Expected 'On' -Actual 'On' }
    Out-Result fail -Expected 'On' -Actual 'Off'
}
