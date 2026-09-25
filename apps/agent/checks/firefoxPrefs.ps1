# ff.acrobat-plugin: the Toolbox Firefox profile hands PDFs to the Acrobat NPAPI plugin (Always Activate).
. "$PSScriptRoot\_lib.ps1"
$P = Get-Params

Invoke-Check {
    $dirs = @(Get-FirefoxProfileDirs $P.user $P.profileDir)
    $adobe = Get-ExistingPaths @('C:\Program Files (x86)\Adobe', 'C:\Program Files\Adobe')
    $plugin = @(if ($adobe.Count) { Get-ChildItem -LiteralPath $adobe -Recurse -Filter nppdf32.dll -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName } })
    $want = @{}
    foreach ($prop in $P.prefs.PSObject.Properties) { $want[$prop.Name] = "$($prop.Value)" }
    $expected = ($want.Keys | Sort-Object | ForEach-Object { "$_=$($want[$_])" }) -join ', '
    if ($dirs.Count -eq 0) { Out-Result needs_human -Expected $expected -Actual 'no Firefox profile found' -Evidence @{ plugin = $plugin } }
    $report = @()
    $good = $null
    foreach ($d in $dirs) {
        $prefs = Read-FirefoxPrefs $d
        $bad = @($want.Keys | Where-Object { "$($prefs[$_])" -ne $want[$_] } | ForEach-Object { "$_=$($prefs[$_])" })
        $report += @{ profile = $d; mismatched = $bad }
        if ($bad.Count -eq 0 -and -not $good) { $good = $d }
    }
    $ev = @{ profiles = $report; plugin = $plugin }
    if ($plugin.Count -eq 0) { Out-Result fail -Expected "$expected + nppdf32.dll" -Actual 'Adobe Acrobat NPAPI plugin (nppdf32.dll) not found' -Evidence $ev }
    if ($good) { Out-Result pass -Expected $expected -Actual "set in $good" -Evidence $ev }
    Out-Result fail -Expected $expected -Actual (($report | ForEach-Object { "$($_.profile): $($_.mismatched -join ', ')" }) -join ' | ') -Evidence $ev
}
