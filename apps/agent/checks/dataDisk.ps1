# disk.data.* / disk.old-removed: the 4 TB data drive is present, seated, healthy, left RAW, and the old drive is gone. Read-only.
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $min = [double]$P.minBytes; $max = [double]$P.maxBytes
    $disks = @(Get-Disk)
    $internal = @($disks | Where-Object { -not $_.IsBoot -and -not $_.IsSystem -and "$($_.BusType)" -ne 'USB' })
    $cands = @($internal | Where-Object { [double]$_.Size -ge $min -and [double]$_.Size -le $max })
    $summary = @($disks | ForEach-Object { '#{0} {1} {2:N2} TB {3} {4} boot={5} health={6} offline={7}' -f $_.Number, $_.FriendlyName, ($_.Size / 1e12), $_.BusType, $_.PartitionStyle, $_.IsBoot, $_.HealthStatus, $_.IsOffline })
    $ev = @{ disks = $summary }
    $range = '{0:N1}-{1:N1} TB' -f ($min / 1e12), ($max / 1e12)
    $d = if ($cands.Count -eq 1) { $cands[0] } else { $null }
    if ($d) { $ev['dataDisk'] = @{ number = $d.Number; model = $d.FriendlyName; serial = "$($d.SerialNumber)".Trim(); firmware = $d.FirmwareVersion; bus = "$($d.BusType)"; bytes = [double]$d.Size; partitionStyle = "$($d.PartitionStyle)"; offline = $d.IsOffline } }

    switch ($P.aspect) {
        'present' {
            if ($cands.Count -eq 1) { Out-Result pass -Expected "1 disk, $range" -Actual ('1 disk, {0:N2} TB ({1})' -f ($d.Size / 1e12), $d.FriendlyName) -Evidence $ev }
            $actual = if ($cands.Count -eq 0) { '0 disks found' } else { "$($cands.Count) candidate disks" }
            Out-Result fail -Expected "1 disk, $range" -Actual $actual -Evidence $ev
        }
        'oldRemoved' {
            $others = @($internal | Where-Object { -not $d -or $_.Number -ne $d.Number })
            if ($others.Count -eq 0) { Out-Result pass -Expected 'no other internal data disks' -Actual 'none' -Evidence $ev }
            Out-Result fail -Expected 'no other internal data disks' -Actual ((@($others | ForEach-Object { '{0} ({1:N0} GB)' -f $_.FriendlyName, ($_.Size / 1e9) })) -join '; ') -Evidence $ev
        }
    }
    if (-not $d) { Out-Result skip -Actual 'no single 4 TB data disk (see disk.data.present)' -Evidence $ev }

    switch ($P.aspect) {
        'seated' {
            $dd = Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq $d.Number } | Select-Object -First 1
            $since = (Get-Date).AddDays(-1)
            $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 7, 11, 51, 129, 153; StartTime = $since } -MaxEvents 200 -ErrorAction SilentlyContinue |
                Where-Object { $_.Message -match "Harddisk$($d.Number)\\|PhysicalDrive$($d.Number)\b" })
            $ev['driveStatus'] = "$($dd.Status)"; $ev['configManagerErrorCode'] = $dd.ConfigManagerErrorCode
            $ev['ioEvents24h'] = @($events | Select-Object -First 5 | ForEach-Object { "$($_.TimeCreated) id=$($_.Id) $($_.ProviderName)" })
            $problems = @()
            if ("$($dd.Status)" -ne 'OK') { $problems += "status $($dd.Status)" }
            if ($dd.ConfigManagerErrorCode -ne 0) { $problems += "device error code $($dd.ConfigManagerErrorCode)" }
            if ($events.Count) { $problems += "$($events.Count) disk I/O error event(s) in 24 h" }
            if ($problems.Count -eq 0) { Out-Result pass -Expected 'status OK, no I/O errors' -Actual 'OK' -Evidence $ev }
            Out-Result fail -Expected 'status OK, no I/O errors' -Actual ($problems -join '; ') -Evidence $ev
        }
        'health' {
            $pd = Get-PhysicalDisk | Where-Object { "$($_.DeviceId)" -eq "$($d.Number)" } | Select-Object -First 1
            $rel = $null
            if ($pd) { $rel = $pd | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue }
            $predict = @(Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue | Where-Object { $_.PredictFailure })
            $problems = @()
            $health = if ($pd) { "$($pd.HealthStatus)" } else { "$($d.HealthStatus)" }
            if ($health -ne 'Healthy') { $problems += "health $health" }
            if ($rel -and ($rel.ReadErrorsUncorrected -gt 0 -or $rel.WriteErrorsUncorrected -gt 0)) { $problems += "uncorrected errors r=$($rel.ReadErrorsUncorrected) w=$($rel.WriteErrorsUncorrected)" }
            if ($predict.Count) { $problems += 'SMART predicts failure' }
            if ($rel) { $ev['reliability'] = @{ temperature = $rel.Temperature; wear = $rel.Wear; readErrorsUncorrected = $rel.ReadErrorsUncorrected; writeErrorsUncorrected = $rel.WriteErrorsUncorrected } }
            if ($problems.Count -eq 0) { Out-Result pass -Expected 'Healthy, 0 errors' -Actual "$health, 0 errors" -Evidence $ev }
            Out-Result fail -Expected 'Healthy, 0 errors' -Actual ($problems -join '; ') -Evidence $ev
        }
        'unconfigured' {
            $parts = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue)
            $style = "$($d.PartitionStyle)"
            if ($style -eq 'RAW' -and $parts.Count -eq 0) { Out-Result pass -Expected 'RAW, 0 partitions' -Actual 'RAW, 0 partitions' -Evidence $ev }
            $letters = @($parts | Where-Object { $_.DriveLetter } | ForEach-Object { "$($_.DriveLetter):" })
            Out-Result fail -Expected 'RAW, 0 partitions' -Actual ("$style, $($parts.Count) partition(s) $($letters -join ' ')").Trim() -Evidence $ev
        }
    }
    Out-Result error -Actual "unknown aspect '$($P.aspect)'"
}
