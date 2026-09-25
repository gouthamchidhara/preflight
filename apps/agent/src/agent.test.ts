import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_RULES, Rule, type Rule as RuleT } from '@umd/contracts';
import { buildApp, loadConfig as apiConfig, loadGolden, openDb } from '@umd/api';
import type { FastifyInstance } from 'fastify';
import { AGENT_VERSION, AgentService, DiskQueue, banner, cleanEvidence, executeJob, lastJsonLine, makeShell, runRules, type QueueBody, type Shell } from './index.js';
import { AgentConfig } from './config.js';
import { silentLogger } from './log.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'pf-'));

/** Real child processes: stub "check scripts" are small Node programs reading PREFLIGHT_PARAMS. */
function stubChecks(): string {
  const dir = tmp();
  const w = (name: string, body: string) => writeFileSync(join(dir, `${name}.ps1`), body);
  w('ok', `const p=JSON.parse(Buffer.from(process.env.PREFLIGHT_PARAMS,'base64').toString());console.log('noise');console.log(JSON.stringify({status:'pass',expected:p.want,actual:p.want,evidence:{password:'hunter2',size:1}}))`);
  w('fail', `console.log(JSON.stringify({status:'fail',expected:'4 TB',actual:'0 disks'}))`);
  w('hang', `setTimeout(()=>{},60000)`);
  w('garbage', `console.log('not json'); process.exit(3)`);
  w('badstatus', `console.log(JSON.stringify({status:'maybe'}))`);
  w('crash', `throw new Error('boom')`);
  w('skip', `console.log(JSON.stringify({status:'skip',actual:'WWAN not ready'}))`);
  return dir;
}
const nodeShell = makeShell(process.execPath, (script) => [script]);
const rule = (id: string, type: string, extra: Partial<RuleT> = {}): RuleT => Rule.parse({ id, name: id, stage: 'hardware', severity: 'critical', type, timeoutMs: 3000, ...extra });

describe('agent entry', () => {
  it('reports version in banner', () => {
    expect(banner()).toContain(AGENT_VERSION);
    expect(banner()).toContain('contracts');
  });
});

describe('runner (§6.4)', () => {
  const checksDir = stubChecks();

  it('every rule yields exactly one valid result, whatever the script does', async () => {
    const rules = [
      rule('a.ok', 'ok', { params: { want: '4 TB' } }),
      rule('a.fail', 'fail'),
      rule('a.hang', 'hang', { timeoutMs: 500 }),
      rule('a.garbage', 'garbage'),
      rule('a.bad', 'badstatus'),
      rule('a.crash', 'crash'),
      rule('a.skip', 'skip'),
      rule('a.missing', 'noSuchType'),
      rule('a.evil', '..\\..\\evil'),
      rule('a.manual', 'manual', { context: 'human' }),
    ];
    const t0 = Date.now();
    const res = await runRules(rules, { shell: nodeShell, checksDir });
    expect(Date.now() - t0).toBeLessThan(5000); // hang was killed
    const by = Object.fromEntries(res.map((r) => [r.ruleId, r]));
    expect(res).toHaveLength(rules.length);
    expect(by['a.ok']).toMatchObject({ status: 'pass', actual: '4 TB' });
    expect(by['a.ok']!.evidence).toEqual({ password: '<redacted>', size: 1 });
    expect(by['a.fail']).toMatchObject({ status: 'fail', actual: '0 disks' });
    expect(by['a.hang']).toMatchObject({ status: 'error' });
    expect(String(by['a.hang']!.actual)).toMatch(/timed out/);
    expect(by['a.garbage']).toMatchObject({ status: 'error' });
    expect(by['a.bad']).toMatchObject({ status: 'error' });
    expect(by['a.crash']).toMatchObject({ status: 'error' });
    expect(String(JSON.stringify(by['a.crash']!.evidence))).toContain('boom');
    expect(by['a.skip']).toMatchObject({ status: 'skip', skipReason: 'precondition' });
    expect(by['a.missing']!.actual).toMatch(/no script/);
    expect(by['a.evil']!.actual).toMatch(/invalid check type/);
    expect(by['a.manual']).toMatchObject({ status: 'needs_human' });
  });

  it('respects the concurrency cap', async () => {
    let live = 0;
    let peak = 0;
    const shell: Shell = {
      async run() {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 20));
        live--;
        return { code: 0, stdout: '{"status":"pass"}', stderr: '', timedOut: false, durationMs: 20 };
      },
    };
    const rules = Array.from({ length: 12 }, (_, i) => rule(`c.r${i}`, 'ok'));
    await runRules(rules, { shell, checksDir, concurrency: 4 });
    expect(peak).toBe(4);
  });

  it('lastJsonLine ignores noise', () => {
    expect(lastJsonLine('WARNING: x\r\n{"a":1}\r\n\r\n')).toEqual({ a: 1 });
    expect(lastJsonLine('nothing')).toBeUndefined();
  });

  it('evidence is redacted and capped at 8 KB', () => {
    expect(cleanEvidence({ deviceKey: 'k', nested: { trustStorePassword: 'x' }, lines: 'a=1\ndeviceLoginPassword=Zz\nb=2' })).toEqual({
      deviceKey: '<redacted>',
      nested: { trustStorePassword: '<redacted>' },
      lines: 'a=1\ndeviceLoginPassword=<redacted>\nb=2',
    });
    const big = cleanEvidence({ blob: 'x'.repeat(20000) });
    expect(JSON.stringify(big).length).toBeLessThan(8192);
    expect(big.truncated).toBe(true);
  });
});

describe('disk queue', () => {
  it('keeps order, survives reopen, drops corrupt files, caps size', () => {
    const dir = tmp();
    const q = new DiskQueue<{ n: number }>(dir, 3);
    for (let n = 1; n <= 5; n++) q.push('run', { n });
    writeFileSync(join(dir, '000000000000000-000000-run-bad.json'), '{oops');
    const reopened = new DiskQueue<{ n: number }>(dir, 3);
    expect(reopened.list().map((i) => i.body.n)).toEqual([3, 4, 5]);
    expect(readdirSync(dir).some((f) => f.includes('bad'))).toBe(false);
  });
});

describe('job executor (§7)', () => {
  it('rejects non-whitelisted scripts and params before touching the system', async () => {
    const scriptsDir = tmp();
    let ran = false;
    const shell: Shell = { async run() { ran = true; return { code: 0, stdout: '', stderr: '', timedOut: false, durationMs: 0 }; } };
    const deps = { shell, scriptsDir, backupDir: tmp() };
    expect((await executeJob({ id: randomUUID(), scriptId: 'format-disk', params: {} }, deps)).stderr).toMatch(/whitelist/);
    expect((await executeJob({ id: randomUUID(), scriptId: 'lsapl-restore-file', params: { file: 'C:\\Windows' } }, deps)).status).toBe('failed');
    expect((await executeJob({ id: randomUUID(), scriptId: 'lsapl-restore-file', params: { file: 'truststore' } }, deps)).stderr).toMatch(/not bundled/);
    expect(ran).toBe(false);
  });

  it('runs a bundled script with a backup dir and maps exit codes', async () => {
    const scriptsDir = tmp();
    writeFileSync(join(scriptsDir, 'ff-disable-startup.ps1'), `const p=JSON.parse(Buffer.from(process.env.PREFLIGHT_PARAMS,'base64').toString());console.log('backup='+!!p.backupDir);process.exit(0)`);
    writeFileSync(join(scriptsDir, 'delete-shortcut.ps1'), `console.error('nope');process.exit(2)`);
    const deps = { shell: nodeShell, scriptsDir, backupDir: tmp() };
    expect(await executeJob({ id: randomUUID(), scriptId: 'ff-disable-startup', params: {} }, deps)).toMatchObject({ status: 'succeeded', exitCode: 0, stdout: expect.stringContaining('backup=true') });
    expect(await executeJob({ id: randomUUID(), scriptId: 'delete-shortcut', params: { pattern: 'Airwall*.lnk' } }, deps)).toMatchObject({ status: 'failed', exitCode: 2 });
  });
});

describe('end to end: agent ↔ real API (in-process)', () => {
  let app: FastifyInstance;
  let url: string;
  let closeDb: () => Promise<void>;
  const TOKEN = 'e2e-bootstrap-token-0123456789';

  beforeAll(async () => {
    const db = await openDb({ memory: true });
    closeDb = () => db.close();
    app = await buildApp({ cfg: apiConfig({ NODE_ENV: 'test', RATE_LIMIT: 'off', BOOTSTRAP_TOKEN: TOKEN, WEB_DIST: '/none' }), db, golden: loadGolden(), logger: false });
    url = await app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('enrolls, checks in, runs every default check, uploads, executes a fix and re-checks', async () => {
    process.env.PREFLIGHT_DATA = tmp(); // isolates policy cache + key
    // Fake PowerShell: identity + every check type answers; disk.data.present fails until "fixed".
    const checksDir = tmp();
    for (const t of new Set(DEFAULT_RULES.map((r) => r.type))) writeFileSync(join(checksDir, `${t}.ps1`), '');
    writeFileSync(join(checksDir, '_identity.ps1'), '');
    const scriptsDir = tmp();
    writeFileSync(join(scriptsDir, 'lsapl-restore-file.ps1'), '');
    let fixed = false;
    const shell: Shell = {
      async run(script, params) {
        const name = script.split(/[\\/]/).pop()!;
        const ok = (stdout: string) => ({ code: 0, stdout, stderr: '', timedOut: false, durationMs: 1 });
        if (name === '_identity.ps1') return ok(JSON.stringify({ hostname: 'UMD-E2E', serial: 'E2E-SERIAL', assetTag: 'QJ06819999', model: 'CF-33', osBuild: '26100.1', onAC: true, lanUp: true, wwanReady: false }));
        if (name === 'lsapl-restore-file.ps1') {
          fixed = true;
          return ok('restored');
        }
        const p = params as { path?: string };
        const failing = !fixed && p.path?.endsWith('ee-prod-smt-trust.jks');
        return ok(JSON.stringify(failing ? { status: 'fail', expected: 'sha256:aa', actual: 'file missing' } : { status: 'pass', actual: 'ok' }));
      },
    };
    const saved: { cfg?: AgentConfig; key?: string } = {};
    const agent = new AgentService({
      version: 'e2e',
      config: AgentConfig.parse({ serverUrl: url, bootstrapToken: TOKEN }),
      saveConfig: (c) => (saved.cfg = c),
      loadKey: () => saved.key ?? null,
      saveKey: (k) => (saved.key = k),
      shell,
      queue: new DiskQueue<QueueBody>(join(tmp(), 'q')),
      log: silentLogger,
      checksDir,
      scriptsDir,
      backupDir: tmp(),
    });

    await agent.tick(); // enroll + checkin + fetch policy
    expect(saved.key).toBeTruthy();
    expect(saved.cfg?.bootstrapToken).toBeUndefined(); // token dropped after enroll
    await agent.runChecks('startup');

    const inject = (method: 'GET' | 'POST', u: string, payload?: unknown) => app.inject({ method, url: u, payload: payload as never });
    const [dev] = (await inject('GET', '/api/v1/devices')).json();
    expect(dev).toMatchObject({ serial: 'E2E-SERIAL', assetTag: 'QJ06819999', readiness: 'not-ready' });
    expect(dev.failing.map((f: { ruleId: string }) => f.ruleId)).toEqual(['lsapl.truststore']);

    // Tech clicks "Run fix" → job delivered at next checkin → agent runs it → re-check → dashboard clears
    const job = (await inject('POST', `/api/v1/devices/${dev.id}/jobs`, { scriptId: 'lsapl-restore-file', params: { file: 'truststore' }, ruleId: 'lsapl.truststore' })).json();
    await agent.tick();
    expect((await inject('GET', `/api/v1/jobs/${job.id}`)).json()).toMatchObject({ status: 'succeeded' });
    const after = (await inject('GET', `/api/v1/devices/${dev.id}`)).json();
    expect(after.failing).toEqual([]);
    expect(after.results.find((r: { ruleId: string }) => r.ruleId === 'lsapl.truststore').status).toBe('pass');

    // "Run all checks" from the dashboard → runNow at next checkin
    await inject('POST', `/api/v1/devices/${dev.id}/run`, { stage: 'bios' });
    const runsBefore = (await inject('GET', `/api/v1/devices/${dev.id}/runs`)).json().length;
    await agent.tick();
    const runs = (await inject('GET', `/api/v1/devices/${dev.id}/runs`)).json();
    expect(runs.length).toBe(runsBefore + 1);
    expect(runs[0]).toMatchObject({ trigger: 'manual', stage: 'bios' });
  });

  it('queues runs while the server is down and uploads them later', async () => {
    process.env.PREFLIGHT_DATA = tmp();
    const checksDir = tmp();
    writeFileSync(join(checksDir, 'secureBoot.ps1'), '');
    mkdirSync(join(checksDir, 'x'), { recursive: true });
    const shell: Shell = { async run() { return { code: 0, stdout: '{"status":"pass"}', stderr: '', timedOut: false, durationMs: 1 }; } };
    const queue = new DiskQueue<QueueBody>(join(tmp(), 'q'));
    const saved: { key?: string } = {};
    const make = (serverUrl: string) =>
      new AgentService({
        version: 'q', config: AgentConfig.parse({ serverUrl, bootstrapToken: TOKEN }), saveConfig: () => {}, loadKey: () => saved.key ?? null,
        saveKey: (k) => (saved.key = k), shell, queue, log: silentLogger, checksDir, scriptsDir: tmp(), backupDir: tmp(),
      });
    await make(url).ensureEnrolled();
    const offline = make('http://127.0.0.1:9'); // nothing listens on the discard port
    await offline.runChecks('schedule', { ruleIds: ['bios.secureboot'] });
    await offline.runChecks('schedule', { ruleIds: ['bios.secureboot'] });
    expect(queue.size()).toBe(2);
    expect(await make(url).flush()).toBe(2);
    expect(queue.size()).toBe(0);
  });
});
