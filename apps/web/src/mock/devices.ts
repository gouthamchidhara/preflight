/**
 * Deterministic mock fleet covering every readiness state (PLAN.md T5/T7).
 * TODO(T6): replaced by GET /api/v1/devices + /devices/:id/checklist.
 */
import type { Attestation, Checkin, Result } from '@umd/contracts';
import { DEFAULT_RULES as RULES, MANUAL_ITEMS } from '@umd/contracts';

export interface Device {
  id: string;
  assetTag: string;
  hostname: string;
  serial: string;
  model: string;
  variant: 'touch' | 'nontouch';
  biosVersion: string;
  osBuild: string;
  agentVersion: string;
  lastSeenAt: string;
  telemetry: Pick<Checkin, 'onAC' | 'lanUp' | 'wwanReady'>;
  results: Result[];
  attestations: Attestation[];
}

type Override = Partial<Pick<Result, 'status' | 'skipReason' | 'expected' | 'actual' | 'evidence'>>;

/** Realistic expected/actual pairs for a passing check. */
const PASS: Record<string, [unknown, unknown]> = {
  'img.buildstats': ['Finished, green', 'Build 1042436 finished 19:25'],
  'hw.identity': ['^QJ0681\\d{4}$', 'QJ0681xxxx'],
  'os.build': ['26100', '26100'],
  'os.patch': ['UBR ≥ 4652', 'UBR 4652'],
  'app.required-set': ['all required apps', 'all present'],
  'ui.desktop-icons': ['24 icons', '24 icons'],
  'tbx.files-current': ['stamp ≥ 20260629074759, 6 parts', '20260629074759, 6/6 parts'],
  'ui.display': ['1920×1080, Stretched', '1920×1080, Stretched'],
  'ff.acrobat-plugin': ['pdfjs.disabled=true, nppdf32=2', 'pdfjs.disabled=true, nppdf32=2'],
  'cell.apn': ['AA FirstNet / 32871.fn', 'AA FirstNet / 32871.fn'],
  'cell.myboeingfleet': ['HTTP 2xx/3xx via WWAN', 'HTTP 200'],
  'disk.data.present': ['1 disk, 3.8–4.1 TB', '1 disk, 4.00 TB (Samsung 870 EVO)'],
  'disk.data.health': ['Healthy', 'Healthy, 0 errors'],
  'disk.data.unconfigured': ['RAW, 0 partitions', 'RAW, 0 partitions'],
  'bios.version': ['V3.00L14', 'V3.00L14'],
  'bios.secureboot': ['On', 'On'],
};

const MIN = 60_000;
const at = (minsAgo: number) => new Date(Date.now() - minsAgo * MIN).toISOString();

function buildResults(overrides: Record<string, Override>, checkedMinsAgo: number): Result[] {
  return RULES.map((rule) => {
    const o = overrides[rule.id] ?? {};
    const [expected, actual] = PASS[rule.id] ?? ['OK', 'OK'];
    return {
      ruleId: rule.id,
      status: o.status ?? 'pass',
      skipReason: o.skipReason ?? null,
      expected: o.expected ?? expected,
      actual: o.actual ?? (o.status && o.status !== 'pass' ? '—' : actual),
      evidence: o.evidence ?? {},
      durationMs: 40 + (rule.id.length * 13) % 400,
      checkedAt: at(checkedMinsAgo),
    };
  });
}

const allManual = (by = 'j.tech'): Attestation[] =>
  MANUAL_ITEMS.map((i) => ({ itemId: i.id, by, at: at(90) }));
const manualUpTo = (stages: string[], by = 'j.tech'): Attestation[] =>
  MANUAL_ITEMS.filter((i) => stages.includes(i.stage)).map((i) => ({ itemId: i.id, by, at: at(120) }));

const HW_PENDING: Record<string, Override> = {
  'cell.sim-ready': { status: 'fail', expected: 'Initialized', actual: 'SIM not inserted' },
  'cell.myboeingfleet': { status: 'skip', skipReason: 'precondition', actual: 'WWAN not ready' },
  'cell.apn': { status: 'skip', skipReason: 'precondition', actual: 'WWAN not ready' },
  'cell.data-slot': { status: 'skip', skipReason: 'precondition', actual: 'WWAN not ready' },
};

interface Seed {
  n: number;
  model?: string;
  variant?: Device['variant'];
  seenMinsAgo: number;
  checkedMinsAgo: number;
  overrides: Record<string, Override>;
  attestations: Attestation[];
  telemetry?: Device['telemetry'];
}

const SEEDS: Seed[] = [
  { n: 1378, seenMinsAgo: 0.2, checkedMinsAgo: 14, overrides: {}, attestations: allManual() },
  {
    n: 1402, seenMinsAgo: 0.3, checkedMinsAgo: 3, attestations: manualUpTo(['image', 'config']),
    overrides: {
      'disk.data.present': { status: 'fail', expected: '1 disk, 3.8–4.1 TB', actual: '0 disks found', evidence: { internalNonBootDisks: 0 } },
      'disk.data.seated': { status: 'skip', skipReason: 'precondition', actual: 'no data disk' },
      'disk.data.health': { status: 'skip', skipReason: 'precondition', actual: 'no data disk' },
      'disk.data.unconfigured': { status: 'skip', skipReason: 'precondition', actual: 'no data disk' },
      ...HW_PENDING,
    },
  },
  {
    n: 1415, seenMinsAgo: 0.1, checkedMinsAgo: 22, attestations: manualUpTo(['image', 'config']),
    overrides: {
      'cell.sim-ready': { status: 'skip', skipReason: 'precondition', actual: 'awaiting SIM step' },
      'cell.myboeingfleet': { status: 'skip', skipReason: 'precondition', actual: 'WWAN not ready' },
      'bios.version': { status: 'needs_human', actual: 'variant unknown' },
      'bios.settings': { status: 'needs_human', actual: 'Panasonic WMI not available' },
    },
    telemetry: { onAC: true, lanUp: true, wwanReady: false },
  },
  {
    n: 1421, seenMinsAgo: 0.4, checkedMinsAgo: 8, attestations: allManual('a.lead'),
    overrides: {
      'ui.wallpaper': { status: 'fail', expected: 'sha256:9f2c…e1', actual: 'sha256:47ab…0c (default Windows)' },
      'ff.startup-popups': { status: 'fail', expected: 'disabled', actual: 'Firefox enabled in StartupApproved\\Run' },
    },
  },
  {
    n: 1433, seenMinsAgo: 0.2, checkedMinsAgo: 5, attestations: manualUpTo(['image']),
    overrides: {
      'lsapl.truststore': { status: 'fail', expected: 'sha256:c41d…77', actual: 'file missing', evidence: { path: 'C:\\Boeing\\LSAPL-SMT\\Keys\\ee-prod-smt-trust.jks' } },
      'lsapl.app-props': { status: 'fail', expected: '2/2 key hashes match', actual: '0/2 key hashes match' },
      'lsapl.backend': { status: 'fail', expected: 'TCP open', actual: 'timeout after 5 s' },
      'lsapl.airwall-icon': { status: 'fail', expected: 'absent', actual: 'AirwallAgent.lnk on Public Desktop' },
    },
  },
  {
    n: 1447, seenMinsAgo: 190, checkedMinsAgo: 200, attestations: manualUpTo(['image']),
    overrides: { ...HW_PENDING, 'umd.conformance': { status: 'needs_human', actual: 'no CLI found' } },
  },
  {
    n: 1450, seenMinsAgo: 0.5, checkedMinsAgo: 31, attestations: [],
    overrides: {
      'img.buildstats': { status: 'fail', expected: 'Finished, green', actual: 'Build 1042363 red, not finished' },
      'app.intel-gcc': { status: 'fail', expected: 'installed', actual: 'not installed' },
      'app.required-set': { status: 'fail', expected: 'all required apps', actual: '19 of 24 present' },
      'ui.desktop-icons': { status: 'fail', expected: '24 icons', actual: '17 icons' },
    },
  },
  {
    n: 1462, model: 'CF-33 (non-touch)', variant: 'nontouch', seenMinsAgo: 0.2, checkedMinsAgo: 11,
    attestations: manualUpTo(['image', 'config', 'hardware']),
    overrides: {
      'bios.touch-off': { status: 'skip', skipReason: 'not_applicable', actual: 'non-touch variant' },
      'bios.settings': { status: 'needs_human', actual: 'Panasonic WMI not available' },
    },
  },
  { n: 1475, seenMinsAgo: 0.1, checkedMinsAgo: 40, overrides: {}, attestations: allManual() },
  {
    n: 1488, seenMinsAgo: 0.3, checkedMinsAgo: 2, attestations: manualUpTo(['image', 'config']),
    overrides: {
      'disk.data.unconfigured': { status: 'fail', expected: 'RAW, 0 partitions', actual: 'GPT, 1 partition (E: NTFS)' },
      'disk.old-removed': { status: 'fail', expected: 'no other internal disks', actual: '1 extra disk (256 GB)' },
    },
  },
];

export const DEVICES: Device[] = SEEDS.map((s) => ({
  id: `dev-${s.n}`,
  assetTag: `QJ068${s.n.toString().padStart(5, '1')}`,
  hostname: `UMD-QJ068${s.n}`,
  serial: `3KTSA${(s.n * 7919).toString(36).toUpperCase()}`,
  model: s.model ?? 'CF-33 (touch)',
  variant: s.variant ?? 'touch',
  biosVersion: 'V3.00L14',
  osBuild: '26100.4652',
  agentVersion: '0.2.0',
  lastSeenAt: at(s.seenMinsAgo),
  telemetry: s.telemetry ?? { onAC: true, lanUp: true, wwanReady: !('cell.sim-ready' in s.overrides) },
  results: buildResults(s.overrides, s.checkedMinsAgo),
  attestations: s.attestations,
}));
