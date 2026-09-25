/**
 * View-model layer: the only place pages get data from.
 * TODO(T6): swap the mock source for the API client; pages stay unchanged.
 */
import {
  STAGES,
  computeReadiness,
  isStale,
  type Attestation,
  type ReadinessOutput,
  type Stage,
} from '@umd/contracts';
import { MANUAL_ITEMS, RULES } from './mock/catalog.js';
import { DEVICES, type Device } from './mock/devices.js';
import type { DisplayReadiness } from './components/status.js';

export const STAGE_LABEL: Record<Stage, string> = {
  image: 'Image',
  config: 'Config',
  hardware: 'Hardware',
  bios: 'BIOS',
  register: 'Register',
};

export interface DeviceView extends ReadinessOutput {
  device: Device;
  display: DisplayReadiness;
  stale: boolean;
  /** Stage has a failing critical rule (vs only warn). */
  criticalStage: Record<Stage, boolean>;
  completeCount: number;
}

export function viewDevice(device: Device, attestations: Attestation[] = device.attestations): DeviceView {
  const out = computeReadiness({ rules: RULES, results: device.results, manualItems: MANUAL_ITEMS, attestations });
  const stale = isStale(device.lastSeenAt);
  const critical = new Set(out.failing.filter((f) => f.severity === 'critical').map((f) => f.ruleId));
  const criticalStage = Object.fromEntries(
    STAGES.map((s) => [s, RULES.some((r) => r.stage === s && critical.has(r.id))]),
  ) as Record<Stage, boolean>;
  return {
    ...out,
    device,
    stale,
    display: stale ? 'stale' : out.readiness,
    criticalStage,
    completeCount: STAGES.filter((s) => out.stages[s] === 'complete').length,
  };
}

export const listDevices = (): Device[] => DEVICES;
export const getDevice = (id: string): Device | undefined => DEVICES.find((d) => d.id === id);
export { RULES, MANUAL_ITEMS };

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
