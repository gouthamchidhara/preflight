# cell.sim-ready: mobile broadband Ready State = Initialized (SIM inserted and usable).
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $out = (& netsh.exe mbn show readyinfo interface=* 2>&1 | Out-String)
    if ($out -match '(?i)no mobile broadband interface|there is no') { Out-Result fail -Expected 'Initialized' -Actual 'no WWAN interface found' -Evidence @{ raw = $out.Trim() } }
    $states = @([regex]::Matches($out, '(?im)^\s*Ready State\s*:\s*(.+?)\s*$') | ForEach-Object { $_.Groups[1].Value })
    $ev = @{ raw = $out.Trim() }
    if ($states.Count -eq 0) { Out-Result fail -Expected 'Initialized' -Actual 'no WWAN ready info (no SIM/modem?)' -Evidence $ev }
    if ($states -contains 'Initialized') { Out-Result pass -Expected 'Initialized' -Actual 'Initialized' -Evidence $ev }
    Out-Result fail -Expected 'Initialized' -Actual ($states -join ', ') -Evidence $ev
}
