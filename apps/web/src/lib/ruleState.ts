import type { AttestationView, DeviceDetail, Result, ResultStatus, Rule } from '@umd/contracts';

export type RowState = ResultStatus | 'pending' | 'attested';

export function rowState(result: Result | undefined, attested: boolean): RowState {
  if (attested) return 'attested';
  if (!result) return 'pending';
  if (result.status === 'skip' && result.skipReason === 'precondition') return 'pending';
  return result.status;
}

export const isFailing = (s: RowState) => s === 'fail' || s === 'error';

/** Why a check is still open: a tech can act on the first two, only an admin on the third. */
export type OpenKind = 'failing' | 'needs_human' | 'blocked';

/** Everything a tech still has to act on, in one pass over a device detail. */
export interface OpenCheck {
  rule: Rule;
  result: Result | undefined;
  state: RowState;
  kind: OpenKind;
}

export function openChecks(d: DeviceDetail): OpenCheck[] {
  const byRule = new Map(d.results.map((r) => [r.ruleId, r]));
  const attested = new Set(d.attestations.filter((a) => a.ruleId).map((a) => a.ruleId!));
  const unconfigured = new Set(d.unconfigured ?? []);
  return d.rules.flatMap((rule) => {
    const result = byRule.get(rule.id);
    const state = rowState(result, attested.has(rule.id));
    const kind: OpenKind | null = isFailing(state)
      ? 'failing'
      : state === 'needs_human'
        ? unconfigured.has(rule.id)
          ? 'blocked'
          : 'needs_human'
        : null;
    return kind ? [{ rule, result, state, kind }] : [];
  });
}

export function attestationFor(d: DeviceDetail, ruleId: string): AttestationView | undefined {
  return d.attestations.find((a) => a.ruleId === ruleId);
}
