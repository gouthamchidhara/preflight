/**
 * PreflightAgent (PLAN.md §3). Library surface; the executable entry is cli.ts.
 */
import { CONTRACTS_VERSION } from '@umd/contracts';

export const AGENT_VERSION = '0.3.0';

export function banner(): string {
  return `PreflightAgent ${AGENT_VERSION} (contracts ${CONTRACTS_VERSION})`;
}

export { AgentService, sleep, type AgentDeps, type QueueBody } from './agent.js';
export { runRule, runRules, lastJsonLine } from './runner.js';
export { makeShell, powershell, type Shell, type ShellResult } from './shell.js';
export { DiskQueue } from './queue.js';
export { executeJob } from './jobs.js';
export { cleanEvidence } from './redact.js';
