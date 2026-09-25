import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { FastifyInstance } from 'fastify';
import { API_NAME, buildApp, loadConfig, loadGolden, openDb } from './index.js';
import type { Db } from './db.js';

const TOKEN = 'test-bootstrap-token-0123456789';
const golden = loadGolden();

async function makeApp(env: Record<string, string> = {}, jwks?: Parameters<typeof buildApp>[0]['jwks']) {
  const db = await openDb({ memory: true });
  const cfg = loadConfig({ NODE_ENV: 'test', RATE_LIMIT: 'off', BOOTSTRAP_TOKEN: TOKEN, WEB_DIST: '/nonexistent', ...env });
  const app = await buildApp({ cfg, db, golden, jwks, logger: false });
  return { app, db };
}

const now = () => new Date().toISOString();
const checkin = { agentVersion: '0.3.0', osBuild: '26100.4652', uptimeSec: 100, onAC: true, lanUp: true, wwanReady: false };
const result = (ruleId: string, status: string, extra: Record<string, unknown> = {}) => ({
  ruleId,
  status,
  skipReason: status === 'skip' ? 'precondition' : null,
  expected: 'x',
  actual: 'y',
  evidence: {},
  durationMs: 10,
  checkedAt: now(),
  ...extra,
});

async function enroll(app: FastifyInstance, serial = 'SER-1') {
  const r = await app.inject({
    method: 'POST',
    url: '/api/agent/v1/enroll',
    payload: { bootstrapToken: TOKEN, hostname: 'UMD-1', serial, assetTag: 'QJ06811378', model: 'CF-33' },
  });
  expect(r.statusCode).toBe(200);
  return r.json() as { deviceId: string; deviceKey: string };
}

describe('api', () => {
  it('has a stable name', () => expect(API_NAME).toBe('umd-validation-api'));
});

describe('config guard (§8)', () => {
  it('refuses AUTH_MODE=dev in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'dev' })).toThrow(/not allowed/);
  });
  it('refuses entra mode without tenant/audience', () => {
    expect(() => loadConfig({ AUTH_MODE: 'entra' })).toThrow(/ENTRA_TENANT_ID/);
  });
});

describe('agent flow', () => {
  let app: FastifyInstance;
  let db: Db;
  beforeAll(async () => ({ app, db } = await makeApp()));
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('rejects a bad bootstrap token and a bad device key', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/agent/v1/enroll',
      payload: { bootstrapToken: 'wrong-token-wrong-token', hostname: 'h', serial: 's', assetTag: '', model: '' },
    });
    expect(r.statusCode).toBe(401);
    const c = await app.inject({ method: 'POST', url: '/api/agent/v1/checkin', headers: { 'x-device-key': 'x'.repeat(43) }, payload: checkin });
    expect(c.statusCode).toBe(401);
    const none = await app.inject({ method: 'POST', url: '/api/agent/v1/checkin', payload: checkin });
    expect(none.statusCode).toBe(401);
  });

  it('enroll → checkin → policy → run → dashboard shows result', async () => {
    const { deviceId, deviceKey } = await enroll(app);
    const h = { 'x-device-key': deviceKey };

    const c = await app.inject({ method: 'POST', url: '/api/agent/v1/checkin', headers: h, payload: checkin });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({ jobs: [], runNow: false });

    const p = await app.inject({ method: 'GET', url: '/api/agent/v1/policy', headers: h });
    const policy = p.json();
    expect(policy.rules.length).toBeGreaterThan(30);
    expect(policy.rules.every((r: { context: string }) => r.context === 'agent')).toBe(true);
    expect(JSON.stringify(policy)).not.toContain('@golden:');
    expect(policy.policyVersion).toBe(c.json().policyVersion);

    const runId = randomUUID();
    const run = { runId, trigger: 'startup', startedAt: now(), finishedAt: now(), results: [result('disk.data.present', 'fail'), result('bios.secureboot', 'pass')] };
    const r1 = await app.inject({ method: 'POST', url: '/api/agent/v1/runs', headers: h, payload: run });
    expect(r1.json()).toMatchObject({ ok: true, duplicate: false });
    const r2 = await app.inject({ method: 'POST', url: '/api/agent/v1/runs', headers: h, payload: run });
    expect(r2.json()).toMatchObject({ duplicate: true });

    const list = (await app.inject({ method: 'GET', url: '/api/v1/devices' })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: deviceId, readiness: 'not-ready', display: 'not-ready', assetTag: 'QJ06811378' });
    expect(list[0].failing.map((f: { ruleId: string }) => f.ruleId)).toContain('disk.data.present');

    const detail = (await app.inject({ method: 'GET', url: `/api/v1/devices/${deviceId}` })).json();
    expect(detail.results.find((r: { ruleId: string }) => r.ruleId === 'img.buildstats').status).toBe('needs_human');
    expect(detail.telemetry).toMatchObject({ onAC: true, wwanReady: false });
    expect(detail.lastRunAt).not.toBeNull();
  });

  it('older results never overwrite newer ones (queue flushed out of order)', async () => {
    const { deviceId, deviceKey } = await enroll(app, 'SER-ORDER');
    const h = { 'x-device-key': deviceKey };
    const newer = new Date().toISOString();
    const older = new Date(Date.now() - 3600_000).toISOString();
    const post = (status: string, at: string) =>
      app.inject({
        method: 'POST',
        url: '/api/agent/v1/runs',
        headers: h,
        payload: { runId: randomUUID(), trigger: 'schedule', startedAt: at, finishedAt: at, results: [result('bios.secureboot', status, { checkedAt: at })] },
      });
    await post('pass', newer);
    await post('fail', older);
    const d = (await app.inject({ method: 'GET', url: `/api/v1/devices/${deviceId}` })).json();
    expect(d.results.find((r: { ruleId: string }) => r.ruleId === 'bios.secureboot').status).toBe('pass');
  });

  it('re-enroll by serial keeps device, revokes old key', async () => {
    const a = await enroll(app, 'SER-RE');
    const b = await enroll(app, 'SER-RE');
    expect(b.deviceId).toBe(a.deviceId);
    const old = await app.inject({ method: 'POST', url: '/api/agent/v1/checkin', headers: { 'x-device-key': a.deviceKey }, payload: checkin });
    expect(old.statusCode).toBe(401);
    const fresh = await app.inject({ method: 'POST', url: '/api/agent/v1/checkin', headers: { 'x-device-key': b.deviceKey }, payload: checkin });
    expect(fresh.statusCode).toBe(200);
  });

  it('run-now and jobs are delivered at checkin, one job at a time', async () => {
    const { deviceId, deviceKey } = await enroll(app, 'SER-JOBS');
    const h = { 'x-device-key': deviceKey };
    expect((await app.inject({ method: 'POST', url: `/api/v1/devices/${deviceId}/run`, payload: { stage: 'hardware' } })).statusCode).toBe(200);
    const bad = await app.inject({ method: 'POST', url: `/api/v1/devices/${deviceId}/jobs`, payload: { scriptId: 'rm-rf', params: {} } });
    expect(bad.statusCode).toBe(400);
    const badParams = await app.inject({ method: 'POST', url: `/api/v1/devices/${deviceId}/jobs`, payload: { scriptId: 'lsapl-restore-file', params: { file: '../x' } } });
    expect(badParams.statusCode).toBe(400);
    const j1 = (await app.inject({ method: 'POST', url: `/api/v1/devices/${deviceId}/jobs`, payload: { scriptId: 'lsapl-restore-file', params: { file: 'truststore' }, ruleId: 'lsapl.truststore' } })).json();
    const j2 = (await app.inject({ method: 'POST', url: `/api/v1/devices/${deviceId}/jobs`, payload: { scriptId: 'ff-disable-startup', params: {} } })).json();

    const c1 = (await app.inject({ method: 'POST', url: '/api/agent/v1/checkin', headers: h, payload: checkin })).json();
    expect(c1.runNow).toEqual({ stage: 'hardware' });
    expect(c1.jobs).toHaveLength(1);
    expect(c1.jobs[0]).toMatchObject({ id: j1.id, scriptId: 'lsapl-restore-file', ruleId: 'lsapl.truststore' });

    const c2 = (await app.inject({ method: 'POST', url: '/api/agent/v1/checkin', headers: h, payload: checkin })).json();
    expect(c2.runNow).toBe(false);
    expect(c2.jobs).toHaveLength(0); // j1 still in flight

    const done = await app.inject({ method: 'POST', url: `/api/agent/v1/jobs/${j1.id}/result`, headers: h, payload: { status: 'succeeded', exitCode: 0, stdout: 'ok', stderr: '' } });
    expect(done.statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: `/api/agent/v1/jobs/${j1.id}/result`, headers: h, payload: { status: 'succeeded', exitCode: 0, stdout: 'ok', stderr: '' } });
    expect(again.statusCode).toBe(409);

    const c3 = (await app.inject({ method: 'POST', url: '/api/agent/v1/checkin', headers: h, payload: checkin })).json();
    expect(c3.jobs[0].id).toBe(j2.id);
    expect((await app.inject({ method: 'GET', url: `/api/v1/jobs/${j1.id}` })).json()).toMatchObject({ status: 'succeeded', stdout: 'ok' });
  });

  it('another device cannot finish my job', async () => {
    const a = await enroll(app, 'SER-A');
    const b = await enroll(app, 'SER-B');
    const job = (await app.inject({ method: 'POST', url: `/api/v1/devices/${a.deviceId}/jobs`, payload: { scriptId: 'ff-disable-startup', params: {} } })).json();
    await app.inject({ method: 'POST', url: '/api/agent/v1/checkin', headers: { 'x-device-key': a.deviceKey }, payload: checkin });
    const r = await app.inject({ method: 'POST', url: `/api/agent/v1/jobs/${job.id}/result`, headers: { 'x-device-key': b.deviceKey }, payload: { status: 'succeeded', exitCode: 0, stdout: '', stderr: '' } });
    expect(r.statusCode).toBe(409);
  });

  it('attestations: add, reject unknown, revoke; readiness follows', async () => {
    const { deviceId } = await enroll(app, 'SER-ATT');
    const unknown = await app.inject({ method: 'POST', url: `/api/v1/devices/${deviceId}/attestations`, payload: { itemId: 'man.nope' } });
    expect(unknown.statusCode).toBe(400);
    const a = (await app.inject({ method: 'POST', url: `/api/v1/devices/${deviceId}/attestations`, payload: { itemId: 'man.central', note: 'done' } })).json();
    expect(a).toMatchObject({ itemId: 'man.central', by: 'dev-user' });
    let d = (await app.inject({ method: 'GET', url: `/api/v1/devices/${deviceId}` })).json();
    expect(d.attestations.map((x: { id: string }) => x.id)).toContain(a.id);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/devices/${deviceId}/attestations/${a.id}` })).statusCode).toBe(200);
    d = (await app.inject({ method: 'GET', url: `/api/v1/devices/${deviceId}` })).json();
    expect(d.attestations).toHaveLength(0);
  });

  it('bad bodies and ids are rejected cleanly', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/devices/not-a-uuid' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/devices/${randomUUID()}` })).statusCode).toBe(404);
    const { deviceKey } = await enroll(app, 'SER-BAD');
    const r = await app.inject({ method: 'POST', url: '/api/agent/v1/runs', headers: { 'x-device-key': deviceKey }, payload: { runId: 'x' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().issues.length).toBeGreaterThan(0);
  });

  it('audit log records actions and is append-only', async () => {
    const log = (await app.inject({ method: 'GET', url: '/api/v1/audit' })).json();
    const actions = new Set(log.map((e: { action: string }) => e.action));
    for (const a of ['device.enroll', 'device.reenroll', 'job.create', 'job.rejected', 'job.finish', 'attestation.add', 'attestation.revoke', 'device.run']) {
      expect(actions).toContain(a);
    }
    await expect(db.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });

  it('dev role header enforces roles', async () => {
    const { deviceId } = await enroll(app, 'SER-ROLE');
    const viewer = { 'x-dev-role': 'Viewer' };
    expect((await app.inject({ method: 'GET', url: '/api/v1/devices', headers: viewer })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/devices/${deviceId}/run`, headers: viewer, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/audit', headers: { 'x-dev-role': 'Tech' } })).statusCode).toBe(403);
  });

  it('enrollment tokens honour maxUses', async () => {
    const t = (await app.inject({ method: 'POST', url: '/api/v1/enrollment-tokens', payload: { label: 'pilot', maxUses: 1, expiresInDays: 1 } })).json();
    const body = (serial: string) => ({ bootstrapToken: t.token, hostname: 'h', serial, assetTag: '', model: '' });
    expect((await app.inject({ method: 'POST', url: '/api/agent/v1/enroll', payload: body('T1') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/agent/v1/enroll', payload: body('T2') })).statusCode).toBe(401);
  });
});

describe('entra auth (§8)', () => {
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const AUD = 'api://preflight-test';
  let app: FastifyInstance;
  let db: Db;
  let sign: (claims: Record<string, unknown>, opts?: { aud?: string; iss?: string }) => Promise<string>;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const jwks = createLocalJWKSet({ keys: [jwk] });
    ({ app, db } = await makeApp({ AUTH_MODE: 'entra', ENTRA_TENANT_ID: TENANT, ENTRA_API_AUDIENCE: AUD }, jwks));
    sign = (claims, o = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(o.iss ?? `https://login.microsoftonline.com/${TENANT}/v2.0`)
        .setAudience(o.aud ?? AUD)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const get = (token?: string, url = '/api/v1/devices') =>
    app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('no token → 401, valid token → 200', async () => {
    expect((await get()).statusCode).toBe(401);
    expect((await get(await sign({ roles: ['Preflight.Viewer'], preferred_username: 'a@x' }))).statusCode).toBe(200);
  });

  it('wrong audience or issuer → 401', async () => {
    expect((await get(await sign({ roles: ['Preflight.Admin'] }, { aud: 'api://other' }))).statusCode).toBe(401);
    expect((await get(await sign({ roles: ['Preflight.Admin'] }, { iss: 'https://evil.example/v2.0' }))).statusCode).toBe(401);
  });

  it('no role → 403; Viewer cannot see audit; Admin can', async () => {
    expect((await get(await sign({ preferred_username: 'nobody' }))).statusCode).toBe(403);
    expect((await get(await sign({ roles: ['Preflight.Viewer'] }), '/api/v1/audit')).statusCode).toBe(403);
    expect((await get(await sign({ roles: ['Preflight.Admin'] }), '/api/v1/audit')).statusCode).toBe(200);
  });

  it('dev headers are ignored in entra mode', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/devices', headers: { 'x-dev-user': 'x', 'x-dev-role': 'Admin' } });
    expect(r.statusCode).toBe(401);
  });
});
