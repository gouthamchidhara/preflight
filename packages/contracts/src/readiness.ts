/**
 * Readiness + stage progress (PLAN.md §5.3). Pure, shared by API (source of truth) and web.
 */
import { STAGES, type Attestation, type ManualItem, type Result, type Rule, type Stage } from './schemas.js';

export type Readiness = 'not-ready' | 'in-progress' | 'degraded' | 'ready';
export type StageState = 'complete' | 'failing' | 'pending';

export const STALE_AFTER_MS = 10 * 60 * 1000;

export interface ReadinessInput {
  rules: Rule[];
  /** Latest result per rule (older results must already be dropped). */
  results: Result[];
  manualItems: ManualItem[];
  attestations: Attestation[];
}

export interface ReadinessOutput {
  readiness: Readiness;
  stages: Record<Stage, StageState>;
  failing: { ruleId: string; severity: Rule['severity'] }[];
}

const isFailing = (r: Result | undefined) => r?.status === 'fail' || r?.status === 'error';

/** A rule counts as done when it passed, is not applicable, or a human attested it. */
function ruleDone(result: Result | undefined, attested: boolean): boolean {
  if (attested) return true;
  if (!result) return false;
  return result.status === 'pass' || (result.status === 'skip' && result.skipReason === 'not_applicable');
}

export function computeReadiness(input: ReadinessInput): ReadinessOutput {
  const byRule = new Map(input.results.map((r) => [r.ruleId, r]));
  const attestedRules = new Set(input.attestations.flatMap((a) => (a.ruleId ? [a.ruleId] : [])));
  const attestedItems = new Set(input.attestations.flatMap((a) => (a.itemId ? [a.itemId] : [])));

  const failing = input.rules
    .filter((rule) => isFailing(byRule.get(rule.id)) && !attestedRules.has(rule.id))
    .map((rule) => ({ ruleId: rule.id, severity: rule.severity }));
  const failingIds = new Set(failing.map((f) => f.ruleId));

  // A stage has pending work when a non-failing rule is not done or a manual item is unattested.
  const pendingWork = new Set<Stage>();
  const stages = Object.fromEntries(
    STAGES.map((stage) => {
      const rules = input.rules.filter((r) => r.stage === stage);
      const items = input.manualItems.filter((i) => i.stage === stage);
      const pending =
        rules.some((r) => !failingIds.has(r.id) && !ruleDone(byRule.get(r.id), attestedRules.has(r.id))) ||
        items.some((i) => !attestedItems.has(i.id));
      if (pending) pendingWork.add(stage);
      const state: StageState = rules.some((r) => failingIds.has(r.id)) ? 'failing' : pending ? 'pending' : 'complete';
      return [stage, state];
    }),
  ) as Record<Stage, StageState>;

  let readiness: Readiness;
  if (failing.some((f) => f.severity === 'critical')) readiness = 'not-ready';
  else if (pendingWork.size > 0) readiness = 'in-progress';
  else if (failing.length > 0) readiness = 'degraded';
  else readiness = 'ready';

  return { readiness, stages, failing };
}

/** Display override (§5.3): a device silent for >10 min shows as stale. */
export function isStale(lastSeenAt: string | Date, now: Date = new Date()): boolean {
  const t = typeof lastSeenAt === 'string' ? Date.parse(lastSeenAt) : lastSeenAt.getTime();
  return Number.isNaN(t) || now.getTime() - t > STALE_AFTER_MS;
}
