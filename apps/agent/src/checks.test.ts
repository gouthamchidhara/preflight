/**
 * Runs the real check scripts under PowerShell with Windows cmdlets mocked as functions
 * (PowerShell resolves functions before cmdlets). Needs `pwsh` (or PREFLIGHT_PWSH); CI has it.
 */
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_RULES, resolvePolicy } from '@umd/contracts';
import { readFileSync } from 'node:fs';

const CHECKS = resolve(__dirname, '../checks');
const SCRIPTS = resolve(__dirname, '../scripts');
const PWSH = process.env.PREFLIGHT_PWSH ?? 'pwsh';
const hasPwsh = spawnSync(PWSH, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0;
const tmp = () => mkdtempSync(join(tmpdir(), 'pfps-'));

/** Async on purpose: a blocking spawnSync loop starves vitest's worker heartbeat. */
function ps(script: string, params: unknown, mocks = ''): Promise<{ json: Record<string, unknown>; raw: string }> {
  const dir = tmp();
  const mockFile = join(dir, 'mocks.ps1');
  writeFileSync(mockFile, mocks);
  return new Promise((resolvePs, reject) => {
    const child = spawn(PWSH, ['-NoProfile', '-NonInteractive', '-Command', `. '${mockFile}'; & '${join(CHECKS, script)}'`], {
      env: { ...process.env, PREFLIGHT_PARAMS: Buffer.from(JSON.stringify(params)).toString('base64') },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 90_000);
    child.on('close', () => {
      clearTimeout(timer);
      const raw = `${stdout}\n${stderr}`;
      const line = stdout.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
      if (!line) reject(new Error(`no JSON from ${script}:\n${raw}`));
      else resolvePs({ json: JSON.parse(line), raw });
    });
  });
}

const disk = (o: Record<string, unknown>) =>
  `[pscustomobject]@{ Number=${o.n}; FriendlyName='${o.name ?? 'Disk'}'; SerialNumber='SN${o.n}'; Size=${o.size}; BusType='${o.bus ?? 'SATA'}'; PartitionStyle='${o.style ?? 'RAW'}'; IsBoot=$${o.boot ? 'true' : 'false'}; IsSystem=$${o.boot ? 'true' : 'false'}; IsOffline=$false; HealthStatus='${o.health ?? 'Healthy'}'; FirmwareVersion='1' }`;

function diskMocks(disks: Record<string, unknown>[], extra = '') {
  return `
function Get-Disk { @(${disks.map(disk).join(', ')}) }
function Get-Partition { param($DiskNumber, $ErrorAction) ${extra.includes('PARTS') ? "@([pscustomobject]@{ DriveLetter='E' })" : '@()'} }
function Get-CimInstance { param([Parameter(Position=0)]$ClassName, $Namespace, $Filter) if ($ClassName -eq 'Win32_DiskDrive') { @(${disks.map((d) => `[pscustomobject]@{ Index=${d.n}; Status='OK'; ConfigManagerErrorCode=0 }`).join(', ')}) } else { @() } }
function Get-WinEvent { param($FilterHashtable, $MaxEvents, $ErrorAction) ${extra.includes('EVENTS') ? "@([pscustomobject]@{ TimeCreated=(Get-Date); Id=7; ProviderName='disk'; Message='The device, \\Device\\Harddisk1\\DR1, has a bad block.' })" : '@()'} }
function Get-PhysicalDisk { @(${disks.map((d) => `[pscustomobject]@{ DeviceId='${d.n}'; HealthStatus='${d.health ?? 'Healthy'}' }`).join(', ')}) }
function Get-StorageReliabilityCounter { param($ErrorAction) [pscustomobject]@{ ReadErrorsUncorrected=0; WriteErrorsUncorrected=0; Temperature=30; Wear=1 } }
`;
}

const TB4 = 4_000_787_030_016;
const OS = { n: 0, name: 'OS SSD', size: 512e9, boot: true };
const DATA = { n: 1, name: 'Samsung 870 EVO 4TB', size: TB4 };
const dd = (aspect: string) => ({ aspect, minBytes: 3.8e12, maxBytes: 4.1e12 });

describe.skipIf(!hasPwsh)('PowerShell check scripts', () => {
  it('every .ps1 parses (Windows PowerShell syntax subset)', async () => {
    const files = [...readdirSync(CHECKS).map((f) => join(CHECKS, f)), ...readdirSync(SCRIPTS).map((f) => join(SCRIPTS, f))].filter((f) => f.endsWith('.ps1'));
    const cmd = files
      .map((f) => `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${f}',[ref]$null,[ref]$e); if($e){ $e | % { '${f}:' + $_.Extent.StartLineNumber + ' ' + $_.Message } }`)
      .join('; ');
    const r = spawnSync(PWSH, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('');
  });

  it('every check script emits exactly one valid JSON verdict, even when Windows cmdlets are missing', async () => {
    const golden = JSON.parse(readFileSync(resolve(__dirname, '../../../golden/manifest.json'), 'utf8'));
    const rules = resolvePolicy(DEFAULT_RULES, golden).filter((r) => r.context === 'agent');
    for (const rule of rules) {
      const { json } = (await ps(`${rule.type}.ps1`, rule.params));
      expect(['pass', 'fail', 'error', 'skip', 'needs_human'], `${rule.id}`).toContain(json.status);
    }
  }, 300_000);

  describe('dataDisk (4 TB drive)', () => {
    it('present: one internal 4 TB disk passes', async () => {
      const { json } = (await ps('dataDisk.ps1', dd('present'), diskMocks([OS, DATA])));
      expect(json.status).toBe('pass');
      expect(String(json.actual)).toContain('4.00 TB');
    });
    it('present: nothing detected fails with the disk list as evidence', async () => {
      const { json } = (await ps('dataDisk.ps1', dd('present'), diskMocks([OS])));
      expect(json).toMatchObject({ status: 'fail', actual: '0 disks found' });
      expect(JSON.stringify(json.evidence)).toContain('OS SSD');
    });
    it('present: a 4 TB USB disk does not count', async () => {
      expect((await ps('dataDisk.ps1', dd('present'), diskMocks([OS, { ...DATA, bus: 'USB' }]))).json.status).toBe('fail');
    });
    it('present: two candidates fails', async () => {
      expect((await ps('dataDisk.ps1', dd('present'), diskMocks([OS, DATA, { ...DATA, n: 2 }]))).json.actual).toBe('2 candidate disks');
    });
    it('unconfigured: RAW passes, partitioned fails', async () => {
      expect((await ps('dataDisk.ps1', dd('unconfigured'), diskMocks([OS, DATA]))).json.status).toBe('pass');
      const { json } = (await ps('dataDisk.ps1', dd('unconfigured'), diskMocks([OS, { ...DATA, style: 'GPT' }], 'PARTS')));
      expect(json.status).toBe('fail');
      expect(String(json.actual)).toContain('GPT, 1 partition(s) E:');
    });
    it('unconfigured: skipped (precondition) when the drive is missing', async () => {
      expect((await ps('dataDisk.ps1', dd('unconfigured'), diskMocks([OS]))).json).toMatchObject({ status: 'skip', skipReason: 'precondition' });
    });
    it('health: unhealthy fails', async () => {
      expect((await ps('dataDisk.ps1', dd('health'), diskMocks([OS, { ...DATA, health: 'Warning' }]))).json.status).toBe('fail');
      expect((await ps('dataDisk.ps1', dd('health'), diskMocks([OS, DATA]))).json.status).toBe('pass');
    });
    it('seated: I/O error events on that disk fail', async () => {
      expect((await ps('dataDisk.ps1', dd('seated'), diskMocks([OS, DATA]))).json.status).toBe('pass');
      const { json } = (await ps('dataDisk.ps1', dd('seated'), diskMocks([OS, DATA], 'EVENTS')));
      expect(json.status).toBe('fail');
      expect(String(json.actual)).toContain('I/O error');
    });
    it('oldRemoved: leftover 256 GB disk fails', async () => {
      const { json } = (await ps('dataDisk.ps1', dd('oldRemoved'), diskMocks([OS, DATA, { n: 2, name: 'Old SSD', size: 256e9 }])));
      expect(json.status).toBe('fail');
      expect(String(json.actual)).toContain('Old SSD');
    });
  });

  describe('cellular', () => {
    const netsh = (body: string) => `function netsh.exe { $a = $args -join ' '; ${body} }`;
    it('mbnReady: Initialized passes, SIM not inserted fails', async () => {
      expect((await ps('mbnReady.ps1', {}, netsh('"Ready info for interface Cellular:`n    Ready State : Initialized"'))).json.status).toBe('pass');
      const { json } = (await ps('mbnReady.ps1', {}, netsh('"    Ready State : SIM not inserted"')));
      expect(json).toMatchObject({ status: 'fail', actual: 'SIM not inserted' });
    });
    it('apnConfig: finds APN in profile XML', async () => {
      const mocks = netsh(`
        if ($a -match 'show interfaces') { return "    Name               : Cellular" }
        if ($a -match 'name=') { return '<MBNProfile><Name>AA FirstNet</Name><Context><AccessString>32871.fn</AccessString></Context></MBNProfile>' }
        return "Profiles on interface Cellular:\`n---------------\`n    AA FirstNet"`);
      const { json } = (await ps('apnConfig.ps1', { apn: { profileName: 'AA FirstNet', apn: '32871.fn' } }, mocks));
      expect(json.status).toBe('pass');
      const wrong = (await ps('apnConfig.ps1', { apn: { profileName: 'AA FirstNet', apn: 'other.apn' } }, mocks)).json;
      expect(wrong.status).toBe('fail');
    });
  });

  describe('files', () => {
    it('fileSetPattern: complete Toolbox set passes; missing part and old stamp fail', async () => {
      const dir = tmp();
      mkdirSync(join(dir, 'deploy'));
      const stamp = '20260629074759';
      const names = [`Offline_AAL_HTML5-FULL_${stamp}_F_index.zip`, `Offline_AAL_HTML5-FULL_${stamp}_F_Setup.exe`, ...[1, 2, 3, 4, 5, 6].map((i) => `Offline_AAL_HTML5-FULL_${stamp}_F_Part_${i}_of_6.zip`)];
      for (const n of names) writeFileSync(join(dir, n), 'x');
      expect((await ps('fileSetPattern.ps1', { dir, minStamp: stamp, parts: 6 })).json).toMatchObject({ status: 'pass', actual: `${stamp}, 6/6 parts` });
      expect((await ps('fileSetPattern.ps1', { dir, minStamp: '20270101000000', parts: 6 })).json.status).toBe('fail');
      const dir2 = tmp();
      mkdirSync(join(dir2, 'deploy'));
      for (const n of names.filter((n) => !n.includes('Part_4'))) writeFileSync(join(dir2, n), 'x');
      const { json } = (await ps('fileSetPattern.ps1', { dir: dir2, minStamp: stamp, parts: 6 }));
      expect(json.status).toBe('fail');
      expect(String(json.actual)).toContain('Part_4');
    });

    it('fileHash: compares to source when golden is TBD, to golden when set', async () => {
      const dir = tmp();
      writeFileSync(join(dir, 'src.jks'), 'good');
      writeFileSync(join(dir, 'dst.jks'), 'good');
      const golden = 'sha256:' + createHash('sha256').update('good').digest('hex');
      const base = { path: join(dir, 'dst.jks'), source: join(dir, 'src.jks') };
      expect((await ps('fileHash.ps1', { ...base, sha256: 'TBD(P0-9)' })).json.status).toBe('pass');
      expect((await ps('fileHash.ps1', { ...base, sha256: golden })).json.status).toBe('pass');
      writeFileSync(join(dir, 'dst.jks'), 'tampered');
      expect((await ps('fileHash.ps1', { ...base, sha256: golden })).json.status).toBe('fail');
      expect((await ps('fileHash.ps1', { ...base, path: join(dir, 'missing.jks'), sha256: golden })).json).toMatchObject({ status: 'fail', actual: 'file missing' });
    });

    it('propsKeyHash: never prints secret values', async () => {
      const dir = tmp();
      const secret = 'Sup3r$ecretValue!';
      const file = join(dir, 'application.properties');
      writeFileSync(file, `# conf\ndeviceLoginPassword=${secret}\ntrustStorePassword=other\nserver=x\n`);
      const good = 'sha256:' + createHash('sha256').update(secret).digest('hex');
      const tbd = (await ps('propsKeyHash.ps1', { path: file, keyHashes: { deviceLoginPassword: 'TBD(P0-9)', trustStorePassword: 'TBD(P0-9)' } }));
      expect(tbd.json.status).toBe('needs_human');
      expect(tbd.raw).not.toContain(secret);
      expect(JSON.stringify(tbd.json.evidence)).toContain(good);
      const ok = (await ps('propsKeyHash.ps1', { path: file, keyHashes: { deviceLoginPassword: good } }));
      expect(ok.json.status).toBe('pass');
      const bad = (await ps('propsKeyHash.ps1', { path: file, keyHashes: { deviceLoginPassword: 'sha256:00' } }));
      expect(bad.json).toMatchObject({ status: 'fail', actual: 'deviceLoginPassword differs' });
      expect(bad.raw).not.toContain(secret);
    });
  });

  describe('system', () => {
    it('osVersion: build compare and TBD → needs_human', async () => {
      const m = `function Get-ItemProperty { param($Path) [pscustomobject]@{ CurrentBuild='26100'; UBR=4652; ProductName='Windows 11 Enterprise'; DisplayVersion='24H2' } }`;
      expect((await ps('osVersion.ps1', { build: '26100' }, m)).json).toMatchObject({ status: 'pass', actual: '26100.4652' });
      expect((await ps('osVersion.ps1', { build: '22631' }, m)).json.status).toBe('fail');
      expect((await ps('osVersion.ps1', { build: 'TBD' }, m)).json.status).toBe('needs_human');
      expect((await ps('osVersion.ps1', { minUbr: 5000 }, m)).json.status).toBe('fail');
    });
    it('identity: asset tag pattern', async () => {
      const m = (tag: string) => `function Get-CimInstance { param([Parameter(Position=0)]$ClassName) switch ($ClassName) { 'Win32_SystemEnclosure' { [pscustomobject]@{ SMBIOSAssetTag='${tag}' } } 'Win32_BIOS' { [pscustomobject]@{ SerialNumber='3KTSA1' } } default { [pscustomobject]@{ Model='CF-33'; SystemSKUNumber='X' } } } }`;
      expect((await ps('identity.ps1', { assetTagPattern: '^QJ0681\\d{4}$' }, m('QJ06811378'))).json.status).toBe('pass');
      expect((await ps('identity.ps1', { assetTagPattern: '^QJ0681\\d{4}$' }, m(' '))).json).toMatchObject({ status: 'fail', actual: '(empty)' });
    });
    it('biosVersion: variant unknown accepts any current release', async () => {
      const m = `function Get-CimInstance { param([Parameter(Position=0)]$ClassName) if ($ClassName -eq 'Win32_BIOS') { [pscustomobject]@{ SMBIOSBIOSVersion='V3.00L14'; ReleaseDate='' } } else { [pscustomobject]@{ Model='CF-33'; SystemSKUNumber='CF-33RZ' } } }`;
      expect((await ps('biosVersion.ps1', { versions: { touch: 'TBD', nontouch: 'TBD' }, touchSkuPattern: 'TBD' }, m)).json.status).toBe('needs_human');
      expect((await ps('biosVersion.ps1', { versions: { touch: 'V3.00L14', nontouch: 'V2.00L20' }, touchSkuPattern: 'TBD' }, m)).json.status).toBe('pass');
      expect((await ps('biosVersion.ps1', { versions: { touch: 'V3.00L15', nontouch: 'V2.00L20' }, touchSkuPattern: 'TBD' }, m)).json.status).toBe('fail');
      expect((await ps('biosVersion.ps1', { versions: { touch: 'V3.00L14', nontouch: 'V2.00L20' }, touchSkuPattern: 'RZ$' }, m)).json.status).toBe('pass');
    });
    it('pnpAbsent: Bluetooth radio present fails', async () => {
      const m = (cls: string) => `function Get-PnpDevice { param([switch]$PresentOnly, $ErrorAction) @([pscustomobject]@{ Class='${cls}'; FriendlyName='Intel Wireless Bluetooth'; Status='OK' }) }`;
      expect((await ps('pnpAbsent.ps1', { class: 'Bluetooth' }, m('Bluetooth'))).json.status).toBe('fail');
      expect((await ps('pnpAbsent.ps1', { class: 'Bluetooth' }, m('Net'))).json.status).toBe('pass');
    });
  });
});
