/**
 * Default policy: every check (PLAN.md §6.1), manual step (§5.6) and whitelisted script (§7).
 * Single source of truth for API seed, agent offline mode and web mock.
 *
 * Params may reference golden values as "@golden:<key>" (§5.5); resolvePolicy() fills them in.
 * A value still starting with "TBD" tells the check script to report what it found
 * as `needs_human` instead of guessing a verdict.
 */
import { z } from 'zod';
import { Rule, ManualItem, type Rule as RuleT, type ManualItem as ManualItemT } from './schemas.js';

const LSAPL = 'C:\\Boeing\\LSAPL-SMT';
const CCC = 'C:\\com-code-client';
const USER = 'Mechanic';

type Def = {
  id: string;
  name: string;
  stage: RuleT['stage'];
  severity: RuleT['severity'];
  type: string;
  params?: Record<string, unknown>;
  hint?: string;
  fix?: { scriptId: string; params?: Record<string, unknown> };
  context?: RuleT['context'];
  timeoutMs?: number;
};

const g = (key: string) => `@golden:${key}`;
const disk = (aspect: string) => ({ aspect, minBytes: g('disk.data.minBytes'), maxBytes: g('disk.data.maxBytes') });

const DEFS: Def[] = [
  // ---------- S1 image ----------
  { id: 'img.buildstats', name: 'Imaging finished (buildstats green)', stage: 'image', severity: 'critical', type: 'buildstats', context: 'server', hint: 'Red build → re-image the device.' },
  { id: 'hw.identity', name: 'Asset tag set (QJ0681xxxx)', stage: 'image', severity: 'critical', type: 'identity', params: { assetTagPattern: g('assetTagPattern') }, hint: 'Run Panasonic PC Asset Tag Entry.' },
  { id: 'acct.mechanic', name: 'Mechanic account enabled', stage: 'image', severity: 'critical', type: 'localUser', params: { name: USER }, hint: 'Reset the Mechanic password per checklist.' },
  { id: 'os.build', name: 'OS build matches target', stage: 'image', severity: 'critical', type: 'osVersion', params: { build: g('os.build') } },
  { id: 'os.patch', name: 'Cumulative update applied', stage: 'image', severity: 'critical', type: 'osVersion', params: { minUbr: g('os.minUbr') } },
  { id: 'gpo.applied', name: 'Computer GPOs applied', stage: 'image', severity: 'warn', type: 'gpoApplied', params: { required: g('gpo.required') }, timeoutMs: 90_000 },
  { id: 'app.intel-gcc', name: 'Intel Graphics Command Center installed', stage: 'image', severity: 'critical', type: 'appxPresent', params: { name: '*IntelGraphicsExperience*' }, hint: 'Install via Company Portal → ask the Managed By owner → re-image.' },
  { id: 'app.required-set', name: 'Required apps installed', stage: 'image', severity: 'critical', type: 'appSet', params: { required: g('apps.required') } },
  { id: 'ui.desktop-icons', name: '24 desktop icons present', stage: 'image', severity: 'critical', type: 'shortcutSet', params: { icons: g('desktop.icons'), user: USER }, hint: 'SCCM delivery problem — escalate.' },
  { id: 'ui.wallpaper', name: 'AA desktop background', stage: 'image', severity: 'warn', type: 'fileHashAny', params: { dir: `%USERPROFILE:${USER}%\\AppData\\Roaming\\Microsoft\\Windows\\Themes\\CachedFiles`, sha256: g('wallpaper.sha256') }, hint: 'Reboot twice first, then run the fix.', fix: { scriptId: 'wallpaper-restore' } },
  // ---------- S2 config ----------
  { id: 'tbx.files-current', name: 'Toolbox Remote 787 files current', stage: 'config', severity: 'critical', type: 'fileSetPattern', params: { dir: 'C:\\787\\ToolboxRemote787', minStamp: g('toolbox.minStamp'), parts: g('toolbox.parts') }, hint: 'SCCM not delivering — escalate to SCCM owner.' },
  { id: 'tbx.shortcuts', name: '787 MCDF + Toolbox Remote (ML) shortcuts', stage: 'config', severity: 'critical', type: 'shortcutSet', params: { icons: [{ name: '787 MCDF' }, { name: 'Toolbox Remote (ML)' }], user: USER } },
  { id: 'tbx.launch', name: 'Toolbox Remote (ML) launches', stage: 'config', severity: 'warn', type: 'manual', context: 'human', hint: 'Open it once and confirm, then attest.' },
  { id: 'ui.display', name: 'Display 1920×1080, scale Stretched', stage: 'config', severity: 'warn', type: 'displayConfig', params: { width: 1920, height: 1080, scaling: 'TBD(P0-6)' }, hint: 'Intel GCC → Display → Scale → Stretched; then 1920×1080.' },
  { id: 'ff.acrobat-plugin', name: 'Firefox opens PDFs with Adobe Acrobat', stage: 'config', severity: 'critical', type: 'firefoxPrefs', params: { profileDir: g('ff.profileDir'), user: USER, prefs: { 'pdfjs.disabled': 'true', 'plugin.state.nppdf32': '2' } }, hint: 'Close Firefox, then run the fix.', fix: { scriptId: 'ff-acrobat-prefs' } },
  { id: 'ff.startup-popups', name: 'Firefox startup popups disabled', stage: 'config', severity: 'warn', type: 'startupDisabled', params: { namePattern: 'firefox', user: USER }, fix: { scriptId: 'ff-disable-startup' } },
  { id: 'lsapl.connections', name: 'LSAPL connections.properties correct', stage: 'config', severity: 'critical', type: 'fileHash', params: { path: `${LSAPL}\\App\\conf\\connections.properties`, source: `${CCC}\\connections.properties`, sha256: g('lsapl.connections.sha256') }, hint: '"LSAPL is not a location" error.', fix: { scriptId: 'lsapl-restore-file', params: { file: 'connections' } } },
  { id: 'lsapl.truststore', name: 'LSAPL trust store (.jks) present', stage: 'config', severity: 'critical', type: 'fileHash', params: { path: `${LSAPL}\\Keys\\ee-prod-smt-trust.jks`, source: `${CCC}\\ee-prod-smt-trust.jks`, sha256: g('lsapl.truststore.sha256') }, hint: '"Missing JKS file" error.', fix: { scriptId: 'lsapl-restore-file', params: { file: 'truststore' } } },
  { id: 'lsapl.app-props', name: 'LSAPL application.properties credentials', stage: 'config', severity: 'critical', type: 'propsKeyHash', params: { path: `${LSAPL}\\App\\conf\\application.properties`, keyHashes: g('lsapl.appprops.keyHashes') }, hint: '"Check tools>log for details" error. Fix by hand per checklist until a secret store exists.' },
  { id: 'lsapl.airwall-icon', name: 'Airwall icon removed from desktop', stage: 'config', severity: 'warn', type: 'fileAbsent', params: { dirs: ['C:\\Users\\Public\\Desktop', `%USERPROFILE:${USER}%\\Desktop`], pattern: 'Airwall*.lnk' }, fix: { scriptId: 'delete-shortcut', params: { pattern: 'Airwall*.lnk' } } },
  { id: 'lsapl.airwall-agent', name: 'Airwall Agent running', stage: 'config', severity: 'warn', type: 'serviceRunning', params: { name: g('airwall.serviceName'), pattern: 'airwall' }, hint: 'Request the QJ be added to Airwall.' },
  { id: 'lsapl.backend', name: 'LSAPL backend reachable', stage: 'config', severity: 'critical', type: 'propsHostsReachable', params: { path: `${LSAPL}\\App\\conf\\connections.properties`, timeoutMs: 5000 }, hint: 'Airwall enrollment missing, or ground network down.', timeoutMs: 60_000 },
  { id: 'lsapl.log', name: 'No known LSAPL log errors', stage: 'config', severity: 'warn', type: 'logScan', params: { dir: LSAPL, patterns: g('lsapl.logErrorPatterns') } },
  { id: 'umd.conformance', name: 'UMD Tools conformance', stage: 'config', severity: 'critical', type: 'umdConformance', params: { allowedWarnings: g('umdtools.allowedWarnings') }, hint: 'Open UMD Tools → Check Conformance, then attest.' },
  { id: 'sccm.pkg-12650', name: 'Sign-out fix (pkg 12650) installed', stage: 'config', severity: 'warn', type: 'sccmProgram', params: { match: '12650' }, hint: 'Software Center → search 12650 → Reinstall (signs you out).' },
  { id: 'net.ground', name: 'Ground network reachable', stage: 'config', severity: 'critical', type: 'networkReachable', params: { host: g('net.groundHost'), port: 443 } },
  // ---------- S3 hardware ----------
  { id: 'cell.sim-ready', name: 'SIM inserted and ready', stage: 'hardware', severity: 'critical', type: 'mbnReady', hint: 'Reseat the SIM and screw the cap back on.' },
  { id: 'cell.data-slot', name: 'SIM 1 used for data', stage: 'hardware', severity: 'warn', type: 'mbnSlot', params: { expectedSlot: 'TBD(P0-13)' }, hint: 'Cellular settings → Use this SIM for cellular data.' },
  { id: 'cell.apn', name: 'APN AA FirstNet / 32871.fn', stage: 'hardware', severity: 'critical', type: 'apnConfig', params: { apn: g('cell.apn') }, hint: 'Mobile operator settings → Add APN.' },
  { id: 'cell.myboeingfleet', name: 'myboeingfleet.com reachable over cellular', stage: 'hardware', severity: 'critical', type: 'wwanHttp', params: { url: 'https://myboeingfleet.com' }, timeoutMs: 40_000 },
  { id: 'disk.data.present', name: '4 TB drive detected', stage: 'hardware', severity: 'critical', type: 'dataDisk', params: disk('present'), hint: 'Power off, reseat the caddy, confirm it is the 4 TB unit.' },
  { id: 'disk.data.seated', name: '4 TB drive seated (no I/O errors)', stage: 'hardware', severity: 'warn', type: 'dataDisk', params: disk('seated'), hint: 'Loose or damaged seating — reseat.', timeoutMs: 30_000 },
  { id: 'disk.data.health', name: '4 TB drive healthy', stage: 'hardware', severity: 'critical', type: 'dataDisk', params: disk('health'), hint: 'Replace the drive.' },
  { id: 'disk.data.unconfigured', name: '4 TB drive left unconfigured (RAW)', stage: 'hardware', severity: 'critical', type: 'dataDisk', params: disk('unconfigured'), hint: 'Must stay unconfigured. No auto-fix — the agent never wipes disks.' },
  { id: 'disk.old-removed', name: 'Old drive removed', stage: 'hardware', severity: 'warn', type: 'dataDisk', params: disk('oldRemoved'), hint: 'The old drive may still be installed.' },
  { id: 'disk.os-health', name: 'OS disk healthy, ≥ 20 GB free', stage: 'hardware', severity: 'warn', type: 'diskHealth', params: { minFreeGb: 20 } },
  // ---------- S4 bios ----------
  { id: 'bios.version', name: 'BIOS version current (for variant)', stage: 'bios', severity: 'critical', type: 'biosVersion', params: { versions: g('bios.version'), touchSkuPattern: 'TBD(P0-11)' }, hint: 'Run the BIOS package for this variant. Touch package fails on non-touch units.' },
  { id: 'bios.secureboot', name: 'Secure Boot enabled', stage: 'bios', severity: 'critical', type: 'secureBoot', hint: 'Security → Secure Boot Control → Enabled.' },
  { id: 'bios.bluetooth-off', name: 'Bluetooth disabled in BIOS', stage: 'bios', severity: 'warn', type: 'pnpAbsent', params: { class: 'Bluetooth' }, hint: 'Advanced → Wireless → Bluetooth Disabled.' },
  { id: 'bios.touch-off', name: 'Touchscreen disabled in BIOS', stage: 'bios', severity: 'warn', type: 'pnpAbsent', params: { namePattern: 'touch ?screen' }, hint: 'Advanced → Touchscreen Disabled.' },
  { id: 'bios.boot-order', name: 'Boot order set, no LAN boot', stage: 'bios', severity: 'warn', type: 'firmwareBootOrder', params: { first: g('bios.bootFirst') }, hint: 'Boot → UEFI Boot from LAN Disabled; set Boot Option #1.' },
  { id: 'bios.settings', name: 'Other BIOS settings', stage: 'bios', severity: 'warn', type: 'biosSetting', hint: 'Check Power On AC, Concealed Mode, Password on Boot, supervisor password; then attest.' },
];

export const DEFAULT_RULES: RuleT[] = DEFS.map((d) =>
  Rule.parse({
    id: d.id,
    name: d.name,
    stage: d.stage,
    severity: d.severity,
    type: d.type,
    params: d.params ?? {},
    hint: d.hint,
    context: d.context ?? 'agent',
    timeoutMs: d.timeoutMs ?? 20_000,
    remediation: d.fix ? { scriptId: d.fix.scriptId, params: d.fix.params ?? {}, auto: false } : undefined,
  }),
);

export const MANUAL_ITEMS: ManualItemT[] = (
  [
    ['man.bes', 'image', "Device is BES'd"],
    ['man.oobe', 'image', 'OOBE temp setup done'],
    ['man.qj-label', 'image', 'QJ label applied'],
    ['man.bios-preimage', 'image', 'BIOS pre-image settings entered'],
    ['man.mcdf-opens', 'config', '787 MCDF opens'],
    ['man.3d-render', 'config', '3D DMC diagram renders (Ch. 21)'],
    ['man.lsapl-ground', 'config', 'LSAPL "Connected to Ground Network"'],
    ['man.airwall-request', 'config', 'Airwall request submitted for QJ'],
    ['man.sim-cap', 'hardware', 'SIM inserted and cap screwed back'],
    ['man.drive-swap', 'hardware', 'Old drive removed, 4 TB installed'],
    ['man.bios-update', 'bios', 'BIOS update run for correct variant'],
    ['man.supervisor-pw', 'bios', 'Supervisor password set'],
    ['man.rfid', 'register', 'RFID tag applied and scanned'],
    ['man.central', 'register', 'Added to Central (EID = asset tag, Gallery Type 1)'],
  ] as const
).map(([id, stage, label]) => ManualItem.parse({ id, stage, label }));

/**
 * Whitelisted scripts (§7). Both API (on job create) and agent (on job receive) validate
 * params against these schemas; anything else is rejected.
 */
export const SCRIPT_CATALOG = {
  'lsapl-restore-file': {
    label: 'Restore LSAPL file from C:\\com-code-client',
    params: z.object({ file: z.enum(['connections', 'truststore']) }).strict(),
    confirm: null,
  },
  'delete-shortcut': {
    label: 'Delete desktop shortcut',
    params: z.object({ pattern: z.enum(['Airwall*.lnk']) }).strict(),
    confirm: null,
  },
  'ff-disable-startup': {
    label: 'Disable Firefox at startup + remove desktop icon',
    params: z.object({}).strict(),
    confirm: null,
  },
  'ff-acrobat-prefs': {
    label: 'Set Firefox PDF → Adobe Acrobat (user.js)',
    params: z.object({}).strict(),
    confirm: 'Firefox must be closed.',
  },
  'wallpaper-restore': {
    label: 'Restore AA wallpaper from NAS',
    params: z.object({}).strict(),
    confirm: null,
  },
} as const;

export type KnownScriptId = keyof typeof SCRIPT_CATALOG;
export const SCRIPT_IDS = Object.keys(SCRIPT_CATALOG) as KnownScriptId[];

export function validateScriptParams(scriptId: string, params: unknown): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  const entry = (SCRIPT_CATALOG as Record<string, { params: z.ZodTypeAny }>)[scriptId];
  if (!entry) return { ok: false, error: `unknown scriptId '${scriptId}'` };
  const r = entry.params.safeParse(params ?? {});
  return r.success ? { ok: true, params: r.data as Record<string, unknown> } : { ok: false, error: r.error.issues.map((i) => i.message).join('; ') };
}

/** Golden manifest: flat keys, plus nested objects addressable with dots (e.g. disk.data.minBytes). */
export type Golden = Record<string, unknown>;

function lookupGolden(golden: Golden, key: string): unknown {
  if (key in golden) return golden[key];
  // allow "disk.data.minBytes" → golden["disk.data"].minBytes
  const parts = key.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const head = parts.slice(0, i).join('.');
    if (head in golden) {
      let v: unknown = golden[head];
      for (const p of parts.slice(i)) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[p] : undefined;
      if (v !== undefined) return v;
    }
  }
  return `TBD(golden:${key})`;
}

function resolveValue(v: unknown, golden: Golden): unknown {
  if (typeof v === 'string' && v.startsWith('@golden:')) return lookupGolden(golden, v.slice(8));
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, golden));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x, golden)]));
  return v;
}

/** Replace every "@golden:key" param with the manifest value (§5.5). */
export function resolvePolicy(rules: RuleT[], golden: Golden): RuleT[] {
  return rules.map((r) => ({ ...r, params: resolveValue(r.params, golden) as Record<string, unknown> }));
}

/** True when a value is still a Phase 0 placeholder. */
export const isTbd = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.startsWith('TBD')) || (Array.isArray(v) && v.length === 1 && isTbd(v[0]));
