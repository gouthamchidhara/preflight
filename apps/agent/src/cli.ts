/**
 * PreflightAgent.exe commands:
 *   check    [--stage S] [--rule ID]… [--out FILE] [--json]   run checks locally, no server needed
 *   enroll   --server URL --token TOKEN                        save server + enroll this device
 *   service                                                   run the loop (WinSW calls this)
 *   status                                                    config, enrollment, queue size
 *   version
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Result, Rule } from '@umd/contracts';
import { AGENT_VERSION, banner } from './index.js';
import { AgentService, type QueueBody } from './agent.js';
import { ApiClient } from './api.js';
import { AgentConfig, ensureDataDir, loadConfig, saveConfig } from './config.js';
import { getIdentity } from './identity.js';
import { createLogger } from './log.js';
import { dataDir, homeDir, paths } from './paths.js';
import { currentPolicy, selectRules } from './policy.js';
import { DiskQueue } from './queue.js';
import { runRules } from './runner.js';
import { loadSecret, saveSecret } from './secret.js';
import { powershell } from './shell.js';

type Args = { _: string[]; flags: Record<string, string[]> };

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
      const v = inline ?? (argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true');
      (out.flags[k] ??= []).push(v);
    } else out._.push(a);
  }
  return out;
}

const flag = (a: Args, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];

const LABEL: Record<Result['status'], string> = { pass: 'PASS ', fail: 'FAIL ', error: 'ERROR', skip: 'SKIP ', needs_human: 'HUMAN' };

function show(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 90 ? s.slice(0, 87) + '...' : s;
}

async function cmdCheck(a: Args) {
  const stage = flag(a, 'stage') as Rule['stage'] | undefined;
  const ruleIds = a.flags.rule ?? [];
  const policy = currentPolicy();
  const rules = selectRules(policy.rules, { stage, ruleIds });
  if (!rules.length) {
    console.error('No rules match. Stages: image, config, hardware, bios.');
    process.exitCode = 2;
    return;
  }
  const json = flag(a, 'json') === 'true';
  if (!json) console.log(`${banner()}\nRunning ${rules.length} checks (policy ${policy.policyVersion === 0 ? 'built-in' : policy.policyVersion})...\n`);
  const started = new Date().toISOString();
  const results = await runRules(rules, {
    shell: powershell(),
    checksDir: paths.checks(),
    onResult: (r, rule) => {
      if (!json) console.log(`${LABEL[r.status]}  ${rule.id.padEnd(24)} ${show(r.actual)}`);
    },
  });
  const report = { agent: AGENT_VERSION, startedAt: started, finishedAt: new Date().toISOString(), identity: await getIdentity(powershell(), paths.checks(), true), results };
  const outFile =
    flag(a, 'out') ??
    (() => {
      const dir = join(dataDir(), 'results');
      mkdirSync(dir, { recursive: true });
      return join(dir, `check-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    })();
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  if (json) console.log(JSON.stringify(report));
  else {
    console.log(`\n${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('   ')}`);
    console.log(`Saved: ${outFile}`);
  }
  if (counts.error) process.exitCode = 1;
}

async function cmdEnroll(a: Args) {
  const server = flag(a, 'server');
  const token = flag(a, 'token');
  if (!server || !token) throw new Error('usage: PreflightAgent enroll --server https://preflight.example --token <bootstrap token>');
  ensureDataDir();
  const cfg = AgentConfig.parse({ ...loadConfig(), serverUrl: server, bootstrapToken: token, deviceId: undefined });
  saveConfig(cfg);
  const svc = service(cfg, true);
  await svc.ensureEnrolled();
  console.log(`Enrolled. Config: ${paths.config()}`);
}

function service(cfg: AgentConfig, console_ = false) {
  ensureDataDir();
  return new AgentService({
    version: AGENT_VERSION,
    config: cfg,
    saveConfig,
    loadKey: () => loadSecret(paths.key()),
    saveKey: (k) => saveSecret(paths.key(), k),
    shell: powershell(),
    queue: new DiskQueue<QueueBody>(paths.queue()),
    log: createLogger({ dir: paths.logs(), console: console_ }),
    checksDir: paths.checks(),
    scriptsDir: paths.scripts(),
    backupDir: paths.backups(),
    lastRunFile: paths.lastRun(),
  });
}

async function cmdService() {
  const cfg = loadConfig();
  const svc = service(cfg, true);
  const ac = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(sig, () => ac.abort());
  await svc.serve(ac.signal);
}

async function cmdStatus() {
  const cfg = loadConfig();
  const key = (() => {
    try {
      return loadSecret(paths.key());
    } catch {
      return null;
    }
  })();
  const q = new DiskQueue(paths.queue());
  console.log(
    JSON.stringify(
      {
        version: AGENT_VERSION,
        home: homeDir(),
        data: dataDir(),
        server: cfg.serverUrl ?? null,
        deviceId: cfg.deviceId ?? null,
        enrolled: !!key,
        pendingBootstrap: !!cfg.bootstrapToken,
        queued: q.size(),
        policy: currentPolicy().policyVersion === 0 ? 'built-in' : currentPolicy().policyVersion,
      },
      null,
      2,
    ),
  );
  if (cfg.serverUrl && key) {
    try {
      const api = new ApiClient(cfg.serverUrl, () => key, 8000);
      const p = await api.policy();
      console.log(`Server reachable, policy ${p.policyVersion} (${p.rules.length} rules).`);
    } catch (e) {
      console.log(`Server NOT reachable: ${(e as Error).message}`);
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  const cmd = a._[0] ?? 'help';
  switch (cmd) {
    case 'check':
      return cmdCheck(a);
    case 'enroll':
      return cmdEnroll(a);
    case 'service':
      return cmdService();
    case 'status':
      return cmdStatus();
    case 'version':
      return console.log(banner());
    default:
      console.log(`${banner()}

  check    [--stage image|config|hardware|bios] [--rule ID]... [--out FILE] [--json]
           Run checks on this laptop now. No server needed. Run as Administrator.
  enroll   --server URL --token TOKEN     Connect this laptop to the Preflight server.
  service                                 Run the background loop (the Windows service uses this).
  status                                  Show config, enrollment and upload queue.
  version`);
  }
}

main().catch((e) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
