/**
 * Job executor (§7): only scripts bundled in scripts/, only params that pass the
 * shared whitelist schema, one at a time, 5 min timeout, 64 KB output cap.
 * Scripts back up what they change into the backup dir passed to them.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateScriptParams, type Job } from '@umd/contracts';
import type { Shell } from './shell.js';

export interface JobOutcome {
  status: 'succeeded' | 'failed' | 'timed_out';
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const CAP = 64 * 1024 - 64;
const cap = (s: string) => (s.length > CAP ? s.slice(0, CAP) + '\n[truncated]' : s);
const SCRIPT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function executeJob(job: Pick<Job, 'id' | 'scriptId' | 'params'>, deps: { shell: Shell; scriptsDir: string; backupDir: string; timeoutMs?: number }): Promise<JobOutcome> {
  const v = validateScriptParams(job.scriptId, job.params);
  if (!v.ok) return { status: 'failed', exitCode: null, stdout: '', stderr: `rejected by agent whitelist: ${v.error}` };
  if (!SCRIPT_RE.test(job.scriptId)) return { status: 'failed', exitCode: null, stdout: '', stderr: 'rejected: bad script id' };
  const script = join(deps.scriptsDir, `${job.scriptId}.ps1`);
  if (!existsSync(script)) return { status: 'failed', exitCode: null, stdout: '', stderr: `script not bundled in this agent build: ${job.scriptId}` };

  const backupDir = join(deps.backupDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${job.scriptId}`);
  mkdirSync(backupDir, { recursive: true });
  const out = await deps.shell.run(script, { ...v.params, backupDir }, deps.timeoutMs ?? 5 * 60_000);
  return {
    status: out.timedOut ? 'timed_out' : out.code === 0 ? 'succeeded' : 'failed',
    exitCode: out.code,
    stdout: cap(out.stdout),
    stderr: cap(out.stderr),
  };
}
