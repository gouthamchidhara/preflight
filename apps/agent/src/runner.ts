/**
 * Check runner (§6.4): one PowerShell script per check type, ≤4 at a time, per-rule timeout.
 * Whatever goes wrong, every rule yields exactly one valid Result.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Result, type Rule, type Result as ResultT } from '@umd/contracts';
import type { Shell } from './shell.js';
import { cleanEvidence, cleanValue } from './redact.js';

export interface RunnerOptions {
  shell: Shell;
  checksDir: string;
  concurrency?: number;
  onResult?: (r: ResultT, rule: Rule) => void;
}

const TYPE_RE = /^[A-Za-z][A-Za-z0-9]*$/;

function errorResult(rule: Rule, message: string, durationMs: number, evidence: Record<string, unknown> = {}): ResultT {
  return {
    ruleId: rule.id,
    status: 'error',
    skipReason: null,
    expected: undefined,
    actual: message,
    evidence: cleanEvidence(evidence),
    durationMs,
    checkedAt: new Date().toISOString(),
  };
}

/** Last stdout line that looks like a JSON object. */
export function lastJsonLine(stdout: string): unknown {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.startsWith('{')) {
      try {
        return JSON.parse(lines[i]!);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export async function runRule(rule: Rule, opts: RunnerOptions): Promise<ResultT> {
  const started = Date.now();
  if (rule.context !== 'agent' || rule.type === 'manual') {
    return {
      ruleId: rule.id,
      status: 'needs_human',
      skipReason: null,
      actual: 'Manual check',
      evidence: {},
      durationMs: 0,
      checkedAt: new Date().toISOString(),
    };
  }
  if (!TYPE_RE.test(rule.type)) return errorResult(rule, `invalid check type '${rule.type}'`, 0);
  const script = join(opts.checksDir, `${rule.type}.ps1`);
  if (!existsSync(script)) return errorResult(rule, `no script for check type '${rule.type}'`, 0);

  const out = await opts.shell.run(script, rule.params, rule.timeoutMs);
  const durationMs = Date.now() - started;
  if (out.timedOut) return errorResult(rule, `timed out after ${rule.timeoutMs} ms`, durationMs);
  const parsed = lastJsonLine(out.stdout) as Record<string, unknown> | undefined;
  if (!parsed) {
    return errorResult(rule, `script produced no JSON (exit ${out.code})`, durationMs, {
      stderr: out.stderr.slice(-1500),
      stdout: out.stdout.slice(-500),
    });
  }
  const status = parsed.status;
  const candidate = {
    ruleId: rule.id,
    status,
    skipReason: status === 'skip' ? (parsed.skipReason ?? 'precondition') : null,
    expected: cleanValue(parsed.expected),
    actual: cleanValue(parsed.actual),
    evidence: cleanEvidence(parsed.evidence ?? {}),
    durationMs,
    checkedAt: new Date().toISOString(),
  };
  const v = Result.safeParse(candidate);
  if (!v.success) return errorResult(rule, `invalid script output: ${v.error.issues[0]?.message}`, durationMs, { output: parsed });
  return v.data;
}

export async function runRules(rules: Rule[], opts: RunnerOptions): Promise<ResultT[]> {
  const limit = Math.max(1, opts.concurrency ?? 4);
  const results: ResultT[] = new Array(rules.length);
  let next = 0;
  const worker = async () => {
    while (next < rules.length) {
      const i = next++;
      const rule = rules[i]!;
      let r: ResultT;
      try {
        r = await runRule(rule, opts);
      } catch (e) {
        r = errorResult(rule, `runner crash: ${(e as Error).message}`, 0);
      }
      results[i] = r;
      opts.onResult?.(r, rule);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, rules.length) }, worker));
  return results;
}
