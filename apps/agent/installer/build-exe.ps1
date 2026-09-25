<#
.SYNOPSIS
  Build PreflightAgent.exe (Node single executable) and the install zip. Runs on Windows (CI or dev box)
  from the repo root after `pnpm install`. Output: apps/agent/out/preflight-agent-win-x64.zip
#>
$ErrorActionPreference = 'Stop'
$agent = Resolve-Path (Join-Path $PSScriptRoot '..')
$repo = Resolve-Path (Join-Path $agent '..\..')
$out = Join-Path $agent 'out'
$pkg = Join-Path $out 'preflight-agent'
$winswUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$winswSha = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $pkg -Force | Out-Null

Push-Location $agent
try {
    pnpm --filter @umd/contracts build; if ($LASTEXITCODE) { throw 'contracts build failed' }
    node bundle.mjs; if ($LASTEXITCODE) { throw 'bundle failed' }
    node --experimental-sea-config dist-sea/sea-config.json; if ($LASTEXITCODE) { throw 'sea blob failed' }
    $exe = Join-Path $pkg 'PreflightAgent.exe'
    Copy-Item (Get-Command node).Source $exe
    # node.exe is Authenticode-signed; drop the signature before injecting (re-sign in your pipeline if required)
    $signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'x64' } | Select-Object -First 1
    if ($signtool) { & $signtool.FullName remove /s $exe | Out-Null }
    npx postject $exe NODE_SEA_BLOB dist-sea/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2; if ($LASTEXITCODE) { throw 'postject failed' }
}
finally { Pop-Location }

Copy-Item (Join-Path $agent 'checks') $pkg -Recurse
Copy-Item (Join-Path $agent 'scripts') $pkg -Recurse
Get-ChildItem (Join-Path $pkg 'scripts') -Filter *.mjs | Remove-Item
Copy-Item (Join-Path $repo 'golden\manifest.json') (Join-Path $pkg 'golden.json')
Copy-Item (Join-Path $PSScriptRoot 'PreflightAgent-service.xml'), (Join-Path $PSScriptRoot 'install.ps1'), (Join-Path $PSScriptRoot 'uninstall.ps1') $pkg
Copy-Item (Join-Path $repo 'scripts\probe\probe.ps1') $pkg

$winsw = Join-Path $pkg 'PreflightAgent-service.exe'
Invoke-WebRequest -Uri $winswUrl -OutFile $winsw -UseBasicParsing
$got = (Get-FileHash $winsw -Algorithm SHA256).Hash.ToLower()
if ($got -ne $winswSha) { throw "WinSW checksum mismatch: $got" }

& (Join-Path $pkg 'PreflightAgent.exe') version
if ($LASTEXITCODE) { throw 'built exe does not run' }
Compress-Archive -Path (Join-Path $pkg '*') -DestinationPath (Join-Path $out 'preflight-agent-win-x64.zip') -Force
Write-Host "Built $(Join-Path $out 'preflight-agent-win-x64.zip')"
