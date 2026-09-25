#!/usr/bin/env node
/**
 * mock-agent (PLAN.md T5): pretend to be N UMDs against a real Preflight server.
 *   node dist/index.js --server http://localhost:3000 --token <bootstrap> [--devices 5] [--watch]
 * Enrolls, checks in, posts a run with a realistic mix of results, and (with --watch)
 * keeps checking in every 15 s, executing queued fix jobs by marking them succeeded.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_RULES, type Result, type Rule } from '@umd/contracts';

export const MOCK_AGENT_NAME = 'mock-agent';

type Profile = 'ready' | 'disk-missing' | 'lsapl-broken' | 'sim-pending' | 'wallpaper';
const PROFILES: Profile[] = ['ready', 'disk-missing', 'lsapl-broken', 'sim-pending', 'wallpaper'];

export function resultsFor(profile: Profile, rules: Rule[] = DEFAULT_RULES, fixed: Set<string> = new Set()): Result[] {
  const now = new Date().toISOString();
  const r = (ruleId: string, status: Result['status'], actual: unknown, skipReason: Result['skipReason'] = null): Result => ({
    ruleId, status, skipReason, expected: undefined, actual, evidence: { mock: true }, durationMs: 20 + Math.round(Math.random() * 400), checkedAt: now,
  });
  return rules
    .filter((x) => x.context === 'agent')
    .map((rule) => {
      if (fixed.has(rule.id)) return r(rule.id, 'pass', 'fixed');
      if (profile === 'disk-missing' && rule.id === 'disk.data.present') return r(rule.id, 'fail', '0 disks found');
      if (profile === 'disk-missing' && rule.id.startsWith('disk.data.')) return r(rule.id, 'skip', 'no data disk', 'precondition');
      if (profile === 'lsapl-broken' && rule.id === 'lsapl.truststore') return r(rule.id, 'fail', 'file missing');
      if (profile === 'lsapl-broken' && rule.id === 'lsapl.backend') return r(rule.id, 'fail', 'timeout after 5 s');
      if (profile === 'sim-pending' && rule.id === 'cell.sim-ready') return r(rule.id, 'fail', 'SIM not inserted');
      if (profile === 'sim-pending' && rule.id.startsWith('cell.')) return r(rule.id, 'skip', 'WWAN not ready', 'precondition');
      if (profile === 'wallpaper' && rule.id === 'ui.wallpaper') return r(rule.id, 'fail', 'default Windows wallpaper');
      if (rule.type === 'biosSetting' || rule.type === 'umdConformance') return r(rule.id, 'needs_human', 'Manual check');
      return r(rule.id, 'pass', 'ok');
    });
}

function args(argv: string[]) {
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { server: get('server') ?? 'http://localhost:3000', token: get('token'), devices: Number(get('devices') ?? 5), watch: argv.includes('--watch') };
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.token) throw new Error('usage: mock-agent --server URL --token BOOTSTRAP [--devices N] [--watch]');
  const post = async (path: string, body: unknown, key?: string) => {
    const res = await fetch(new URL(path, a.server), { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-device-key': key } : {}) }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  const fleet = await Promise.all(
    Array.from({ length: a.devices }, async (_, i) => {
      const n = 1500 + i;
      const profile = PROFILES[i % PROFILES.length]!;
      const e = await post('/api/agent/v1/enroll', { bootstrapToken: a.token, hostname: `UMD-MOCK-${n}`, serial: `MOCK-${n}`, assetTag: `QJ068${String(10000 + n)}`, model: 'CF-33 (mock)' });
      return { key: e.deviceKey as string, profile, fixed: new Set<string>() };
    }),
  );
  const tick = async (d: (typeof fleet)[number], run: boolean) => {
    const c = await post('/api/agent/v1/checkin', { agentVersion: 'mock', osBuild: '26100.4652', uptimeSec: 60, onAC: true, lanUp: true, wwanReady: d.profile !== 'sim-pending' }, d.key);
    for (const job of (c.jobs as { id: string; ruleId?: string; scriptId: string }[]) ?? []) {
      await post(`/api/agent/v1/jobs/${job.id}/result`, { status: 'succeeded', exitCode: 0, stdout: `mock ran ${job.scriptId}`, stderr: '' }, d.key);
      if (job.ruleId) d.fixed.add(job.ruleId);
      run = true;
    }
    if (run || c.runNow) {
      const now = new Date().toISOString();
      await post('/api/agent/v1/runs', { runId: randomUUID(), trigger: c.runNow ? 'manual' : 'startup', startedAt: now, finishedAt: now, results: resultsFor(d.profile, DEFAULT_RULES, d.fixed) }, d.key);
    }
  };
  await Promise.all(fleet.map((d) => tick(d, true)));
  console.log(`${fleet.length} mock UMDs enrolled and reporting to ${a.server}`);
  if (!a.watch) return;
  console.log('Watching: checking in every 15 s, fix jobs succeed instantly. Ctrl+C to stop.');
  setInterval(() => void Promise.all(fleet.map((d) => tick(d, false))).catch((e) => console.error(String(e))), 15_000);
}

if (process.argv[1] && /mock-agent|index\.(js|ts)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
