/**
 * API response shapes + the one function that turns raw rows into what the dashboard shows.
 * The API computes this server-side; the web mock uses the same function.
 */
import { STAGES, type Attestation, type Checkin, type JobStatus, type ManualItem, type Result, type Rule, type Stage } from './schemas.js';
import { computeReadiness, isStale, type Readiness, type ReadinessOutput } from './readiness.js';

export type DisplayReadiness = Readiness | 'stale';

export interface DeviceIdentity {
  id: string;
  assetTag: string;
  serial: string;
  hostname: string;
  model: string;
  agentVersion: string;
  osBuild: string;
  lastSeenAt: string | null;
  telemetry: Partial<Pick<Checkin, 'onAC' | 'lanUp' | 'wwanReady'>>;
}

export interface DeviceSummary extends DeviceIdentity, ReadinessOutput {
  display: DisplayReadiness;
  stale: boolean;
  criticalStage: Record<Stage, boolean>;
  completeCount: number;
}

export interface AttestationView extends Attestation {
  id: string;
}

export interface JobView {
  id: string;
  scriptId: string;
  ruleId?: string;
  status: JobStatus;
  createdBy: string;
  createdAt: string;
  finishedAt?: string | null;
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
}

export interface DeviceDetail extends DeviceSummary {
  rules: Rule[];
  results: Result[];
  manualItems: ManualItem[];
  attestations: AttestationView[];
  jobs: JobView[];
  lastRunAt: string | null;
}

/**
 * Rules the agent cannot evaluate (server/human context) get a synthetic `needs_human`
 * result until something real arrives, so they show an Attest button instead of hanging.
 */
export function withSyntheticResults(rules: Rule[], results: Result[], now: Date = new Date()): Result[] {
  const have = new Set(results.map((r) => r.ruleId));
  const extra: Result[] = rules
    .filter((r) => r.context !== 'agent' && !have.has(r.id))
    .map((r) => ({
      ruleId: r.id,
      status: 'needs_human',
      skipReason: null,
      expected: undefined,
      actual: r.context === 'server' ? 'Server check not configured yet (P0-4)' : 'Manual check',
      evidence: {},
      durationMs: 0,
      checkedAt: now.toISOString(),
    }));
  return [...results, ...extra];
}

export function summarizeDevice(
  identity: DeviceIdentity,
  rules: Rule[],
  results: Result[],
  manualItems: ManualItem[],
  attestations: Attestation[],
  now: Date = new Date(),
): DeviceSummary {
  const out = computeReadiness({ rules, results: withSyntheticResults(rules, results, now), manualItems, attestations });
  const stale = identity.lastSeenAt === null || isStale(identity.lastSeenAt, now);
  const critical = new Set(out.failing.filter((f) => f.severity === 'critical').map((f) => f.ruleId));
  const criticalStage = Object.fromEntries(
    STAGES.map((s) => [s, rules.some((r) => r.stage === s && critical.has(r.id))]),
  ) as Record<Stage, boolean>;
  return {
    ...identity,
    ...out,
    stale,
    display: stale ? 'stale' : out.readiness,
    criticalStage,
    completeCount: STAGES.filter((s) => out.stages[s] === 'complete').length,
  };
}
