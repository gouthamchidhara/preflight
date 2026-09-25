# acct.mechanic: local user exists and is enabled. The password is never tested.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $u = Get-LocalUser -Name $P.name -ErrorAction SilentlyContinue
    if (-not $u) { Out-Result fail -Expected "user $($P.name) enabled" -Actual 'user not found' }
    $ev = @{ passwordLastSet = "$($u.PasswordLastSet)"; lastLogon = "$($u.LastLogon)" }
    if ($u.Enabled) { Out-Result pass -Expected 'enabled' -Actual 'enabled' -Evidence $ev }
    Out-Result fail -Expected 'enabled' -Actual 'disabled' -Evidence $ev
}
