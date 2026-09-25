/**
 * UMDAgent service entry (Node SEA, wrapped by WinSW — PLAN.md §3, C5).
 * TODO(T8): config load, enrollment, 15 s checkin, disk queue, pino file logs.
 * TODO(T9): check runner + PowerShell invocation wrapper (§6.4).
 */
import { CONTRACTS_VERSION } from '@umd/contracts';

export const AGENT_VERSION = '0.1.0';

export function banner(): string {
  return `UMDAgent ${AGENT_VERSION} (contracts ${CONTRACTS_VERSION})`;
}

// Entry point only runs when executed directly (kept side-effect free for tests).
if (process.argv[1]?.endsWith('index.js')) {
  console.log(banner());
}
