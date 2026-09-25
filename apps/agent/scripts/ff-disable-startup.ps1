# ff-disable-startup: mark Firefox disabled in Startup Apps (Mechanic + machine) and move the Public Desktop Firefox icon to backup.
# Fix script (PLAN.md §7): prints what it did, exit 0 = success. Backs up before changing anything.
. "$PSScriptRoot\..\checks\_lib.ps1"
$P = Get-Params

function New-DisabledValue {
    # 12 bytes: 0x03 = disabled, then FILETIME of when it was disabled (what Task Manager writes)
    $b = New-Object byte[] 12
    $b[0] = 3
    [BitConverter]::GetBytes([DateTime]::UtcNow.ToFileTimeUtc()).CopyTo($b, 4)
    return , $b
}
function Disable-In([string]$runKey, [string]$approvedKey, [string]$label) {
    $run = Get-RegValues $runKey
    foreach ($k in @($run.Keys)) {
        if ($k -notmatch 'firefox' -and "$($run[$k])" -notmatch 'firefox') { continue }
        if (-not (Test-Path $approvedKey)) { New-Item -Path $approvedKey -Force | Out-Null }
        Set-ItemProperty -Path $approvedKey -Name $k -Value (New-DisabledValue) -Type Binary
        Write-Output "disabled $label startup entry '$k'"
    }
}
& reg.exe export 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved' (Join-Path $P.backupDir 'hklm-startupapproved.reg') /y 2>&1 | Out-Null
Disable-In 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' 'machine'
Invoke-WithUserHive 'Mechanic' {
    param($root)
    Disable-In "$root\Software\Microsoft\Windows\CurrentVersion\Run" "$root\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" 'Mechanic'
}
$startup = Join-Path (Get-UserProfilePath 'Mechanic') 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup'
foreach ($f in @(Get-ChildItem -Path $startup -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'firefox' })) {
    Move-Item -LiteralPath $f.FullName -Destination (Join-Path $P.backupDir $f.Name) -Force
    Write-Output "moved startup-folder item $($f.Name) to backup"
}
foreach ($f in @(Get-ChildItem 'C:\Users\Public\Desktop' -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -match 'firefox' })) {
    Move-Item -LiteralPath $f.FullName -Destination (Join-Path $P.backupDir $f.Name) -Force
    Write-Output "moved Public Desktop icon $($f.Name) to backup"
}
exit 0
