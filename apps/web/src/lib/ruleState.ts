import type { AttestationView, DeviceDetail, Result, ResultStatus, Rule } from '@umd/contracts';

export type RowState = ResultStatus | 'pending' | 'attested';

export function rowState(result: Result | undefined, attested: boolean): RowState {
  if (attested) return 'attested';
  if (!result) return 'pending';
  if (result.status === 'skip' && result.skipReason === 'precondition') return 'pending';
  return result.status;
}

export const isFailing = (s: RowState) => s === 'fail' || s === 'error';

/** Everything a tech still has to act on, in one pass over a device detail. */
export interface OpenCheck {
  rule: Rule;
  result: Result | undefined;
  state: RowState;
}

export function openChecks(d: DeviceDetail): OpenCheck[] {
  const byRule = new Map(d.results.map((r) => [r.ruleId, r]));
  const attested = new Set(d.attestations.filter((a) => a.ruleId).map((a) => a.ruleId!));
  return d.rules
    .map((rule) => ({ rule, result: byRule.get(rule.id), state: rowState(byRule.get(rule.id), attested.has(rule.id)) }))
    .filter(({ state }) => isFailing(state) || state === 'needs_human');
}

export function attestationFor(d: DeviceDetail, ruleId: string): AttestationView | undefined {
  return d.attestations.find((a) => a.ruleId === ruleId);
}
