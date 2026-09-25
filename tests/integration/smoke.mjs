// Live smoke test against a running Preflight API (PGlite or Postgres).
//   node tests/integration/smoke.mjs http://localhost:3000 <bootstrap-token>
// Needs: API started with AUTH_MODE=dev (default) and that BOOTSTRAP_TOKEN; `pnpm build` done.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const [server = 'http://localhost:3000', token] = process.argv.slice(2);
assert.ok(token, 'usage: smoke.mjs <server> <bootstrap-token>');
const api = async (method, path, body, headers = {}) => {
  const r = await fetch(new URL(path, server), { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
};

const health = await api('GET', '/healthz');
assert.equal(health.status, 200);
console.log(`health ok (db=${health.json.db})`);

const run = spawnSync(process.execPath, ['apps/mock-agent/dist/index.js', '--server', server, '--token', token, '--devices', '5'], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr);

const devices = (await api('GET', '/api/v1/devices')).json;
assert.ok(devices.length >= 5, `expected >= 5 devices, got ${devices.length}`);
const byTag = Object.fromEntries(devices.map((d) => [d.assetTag, d]));
assert.equal(byTag.QJ06811501.readiness, 'not-ready');
assert.deepEqual(byTag.QJ06811501.failing.map((f) => f.ruleId), ['disk.data.present']);
console.log(`devices ok: ${devices.map((d) => `${d.assetTag}=${d.display}`).join(' ')}`);

// fix flow: create job → a device checks in → job dispatched → result → re-check run
const dev = byTag.QJ06811502;
const job = (await api('POST', `/api/v1/devices/${dev.id}/jobs`, { scriptId: 'lsapl-restore-file', params: { file: 'truststore' }, ruleId: 'lsapl.truststore' })).json;
assert.equal(job.status, 'queued');
const bad = await api('POST', `/api/v1/devices/${dev.id}/jobs`, { scriptId: 'format-c', params: {} });
assert.equal(bad.status, 400);
const enroll = (await api('POST', '/api/agent/v1/enroll', { bootstrapToken: token, hostname: 'UMD-MOCK-1502', serial: 'MOCK-1502', assetTag: 'QJ06811502', model: 'CF-33 (mock)' })).json;
const key = { 'x-device-key': enroll.deviceKey };
const ci = (await api('POST', '/api/agent/v1/checkin', { agentVersion: 'smoke', osBuild: '1', uptimeSec: 1, onAC: true, lanUp: true, wwanReady: true }, key)).json;
assert.equal(ci.jobs[0]?.id, job.id);
assert.equal((await api('POST', `/api/agent/v1/jobs/${job.id}/result`, { status: 'succeeded', exitCode: 0, stdout: 'ok', stderr: '' }, key)).status, 200);
assert.equal((await api('GET', `/api/v1/jobs/${job.id}`)).json.status, 'succeeded');
console.log('fix flow ok');

const audit = (await api('GET', '/api/v1/audit')).json;
for (const a of ['device.enroll', 'device.reenroll', 'job.create', 'job.rejected', 'job.finish']) assert.ok(audit.some((e) => e.action === a), `audit missing ${a}`);
console.log('audit ok');
console.log('SMOKE PASSED');
