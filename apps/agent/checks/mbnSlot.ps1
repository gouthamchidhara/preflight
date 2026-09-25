# cell.data-slot: SIM slot used for data (expected slot captured in P0-13).
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $out = (& netsh.exe mbn show slotmapping interface=* 2>&1 | Out-String).Trim()
    $slot = [regex]::Match($out, '(?im)^\s*Slot\s*(?:index|mapping)?\s*:\s*(\d+)')
    $actual = if ($slot.Success) { "slot $($slot.Groups[1].Value)" } else { 'unparsed' }
    if (Test-Tbd $P.expectedSlot) { Out-Result needs_human -Actual $actual -Evidence @{ raw = $out } }
    if ($slot.Success -and $slot.Groups[1].Value -eq "$($P.expectedSlot)") { Out-Result pass -Expected "slot $($P.expectedSlot)" -Actual $actual }
    Out-Result fail -Expected "slot $($P.expectedSlot)" -Actual $actual -Evidence @{ raw = $out }
}
