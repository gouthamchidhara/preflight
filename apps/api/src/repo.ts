/**
 * All DB reads/writes. Routes stay thin; everything here is unit-testable against PGlite.
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RULES,
  MANUAL_ITEMS,
  Result,
  resolvePolicy,
  summarizeDevice,
  withSyntheticResults,
  type AttestationView,
  type Checkin,
  type DeviceDetail,
  type DeviceIdentity,
  type DeviceSummary,
  type Golden,
  type JobView,
  type ManualItem,
  type Rule,
  type Run,
} from '@umd/contracts';
import type { Db, Queryable } from './db.js';
import { newSecret, sha256 } from './auth.js';

const POLICY_ID = 'default';
const JOB_DISPATCH_TIMEOUT = "interval '5 minutes'";

const iso = (d: unknown): string | null => (d == null ? null : new Date(d as string).toISOString());
const json = (v: unknown) => JSON.stringify(v ?? null);

/** Stable 31-bit hash so agents can tell when the resolved policy changed. */
function hash31(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h & 0x7fffffff;
}

export class Repo {
  constructor(
    readonly db: Db,
    private golden: Golden,
  ) {}

  // ---------- bootstrap ----------

  /** Seed/refresh default policy + manual items. Admin-edited policies are never overwritten. */
  async seed(): Promise<void> {
    const rows = await this.db.query<{ rules: Rule[]; edited_by: string | null; version: number }>(
      'SELECT rules, edited_by, version FROM policies WHERE id = $1',
      [POLICY_ID],
    );
    const current = rows[0];
    if (!current) {
      await this.db.query('INSERT INTO policies (id, name, version, rules) VALUES ($1, $2, 1, $3::jsonb)', [
        POLICY_ID,
        'Default UMD policy',
        json(DEFAULT_RULES),
      ]);
    } else if (!current.edited_by && json(current.rules) !== json(DEFAULT_RULES)) {
      await this.db.query('UPDATE policies SET rules = $2::jsonb, version = version + 1, updated_at = now() WHERE id = $1', [
        POLICY_ID,
        json(DEFAULT_RULES),
      ]);
    }
    for (const [i, m] of MANUAL_ITEMS.entries()) {
      await this.db.query(
        `INSERT INTO manual_items (id, stage, label, position) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET stage = excluded.stage, label = excluded.label, position = excluded.position`,
        [m.id, m.stage, m.label, i],
      );
    }
  }

  async ensureBootstrapToken(token: string): Promise<void> {
    const h = sha256(token);
    const exists = await this.db.query('SELECT 1 FROM enrollment_tokens WHERE token_hash = $1', [h]);
    if (exists.length) return;
    await this.db.query(
      `INSERT INTO enrollment_tokens (id, label, token_hash, max_uses, expires_at, created_by)
       VALUES ($1, 'env BOOTSTRAP_TOKEN', $2, 1000000, now() + interval '365 days', 'system')`,
      [randomUUID(), h],
    );
  }

  // ---------- policy ----------

  async rules(): Promise<{ version: number; rules: Rule[] }> {
    const r = (await this.db.query<{ version: number; rules: Rule[] }>('SELECT version, rules FROM policies WHERE id = $1', [POLICY_ID]))[0];
    return r ?? { version: 0, rules: [] };
  }

  /** Resolved rules the agent runs (agent context only) + a version that changes with policy or golden. */
  async agentPolicy(): Promise<{ policyVersion: number; rules: Rule[] }> {
    const { rules } = await this.rules();
    const resolved = resolvePolicy(rules, this.golden).filter((r) => r.context === 'agent');
    return { policyVersion: hash31(json(resolved)), rules: resolved };
  }

  async setRules(rules: Rule[], by: string): Promise<number> {
    const r = await this.db.query<{ version: number }>(
      'UPDATE policies SET rules = $2::jsonb, version = version + 1, edited_by = $3, updated_at = now() WHERE id = $1 RETURNING version',
      [POLICY_ID, json(rules), by],
    );
    return r[0]!.version;
  }

  async manualItems(): Promise<ManualItem[]> {
    return this.db.query<ManualItem>('SELECT id, stage, label FROM manual_items ORDER BY position');
  }

  // ---------- enrollment ----------

  async createEnrollmentToken(label: string, maxUses: number, expiresAt: Date, by: string): Promise<string> {
    const token = newSecret();
    await this.db.query(
      'INSERT INTO enrollment_tokens (id, label, token_hash, max_uses, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), label, sha256(token), maxUses, expiresAt.toISOString(), by],
    );
    return token;
  }

  /** Returns null when the token is unknown, revoked, expired or used up. */
  async enroll(e: { bootstrapToken: string; hostname: string; serial: string; assetTag: string; model: string }) {
    return this.db.tx(async (q) => {
      const tok = await q.query(
        `UPDATE enrollment_tokens SET uses = uses + 1
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() AND uses < max_uses
         RETURNING id`,
        [sha256(e.bootstrapToken)],
      );
      if (!tok.length) return null;
      const existing = await q.query<{ id: string }>('SELECT id FROM devices WHERE serial = $1', [e.serial]);
      let deviceId: string;
      let reEnrolled = false;
      if (existing[0]) {
        deviceId = existing[0].id;
        reEnrolled = true;
        await q.query('UPDATE device_keys SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL', [deviceId]);
        await q.query('UPDATE devices SET hostname = $2, asset_tag = $3, model = $4 WHERE id = $1', [deviceId, e.hostname, e.assetTag, e.model]);
      } else {
        deviceId = randomUUID();
        await q.query('INSERT INTO devices (id, serial, hostname, asset_tag, model) VALUES ($1, $2, $3, $4, $5)', [
          deviceId,
          e.serial,
          e.hostname,
          e.assetTag,
          e.model,
        ]);
      }
      const deviceKey = newSecret();
      await q.query('INSERT INTO device_keys (key_hash, device_id) VALUES ($1, $2)', [sha256(deviceKey), deviceId]);
      return { deviceId, deviceKey, reEnrolled };
    });
  }

  // ---------- agent traffic ----------

  async checkin(deviceId: string, c: Checkin) {
    return this.db.tx(async (q) => {
      const dev = await q.query<{ run_request: { stage?: string } | null }>(
        'SELECT run_request FROM devices WHERE id = $1 FOR UPDATE',
        [deviceId],
      );
      await q.query(
        `UPDATE devices SET last_seen_at = now(), agent_version = $2, os_build = $3, telemetry = $4::jsonb, run_request = NULL
         WHERE id = $1`,
        [deviceId, c.agentVersion, c.osBuild, json({ onAC: c.onAC, lanUp: c.lanUp, wwanReady: c.wwanReady, uptimeSec: c.uptimeSec })],
      );
      await this.expireJobs(q);
      const busy = await q.query("SELECT 1 FROM jobs WHERE device_id = $1 AND status IN ('dispatched', 'running')", [deviceId]);
      const jobs = busy.length
        ? []
        : await q.query<{ id: string; script_id: string; params: Record<string, unknown>; rule_id: string | null; created_at: string }>(
            `UPDATE jobs SET status = 'dispatched', dispatched_at = now()
             WHERE id = (SELECT id FROM jobs WHERE device_id = $1 AND status = 'queued' ORDER BY created_at LIMIT 1)
             RETURNING id, script_id, params, rule_id, created_at`,
            [deviceId],
          );
      return {
        runNow: dev[0]?.run_request ?? (false as const),
        jobs: jobs.map((j) => ({
          id: j.id,
          scriptId: j.script_id,
          params: j.params,
          ...(j.rule_id ? { ruleId: j.rule_id } : {}),
          status: 'dispatched' as const,
          createdAt: iso(j.created_at)!,
        })),
      };
    });
  }

  /** Stores a run; idempotent on runId. Latest-per-rule only moves forward in time. */
  async ingestRun(deviceId: string, run: Run): Promise<{ duplicate: boolean }> {
    return this.db.tx(async (q) => {
      const summary: Record<string, number> = {};
      for (const r of run.results) summary[r.status] = (summary[r.status] ?? 0) + 1;
      const ins = await q.query(
        `INSERT INTO runs (id, device_id, trigger, stage, started_at, finished_at, summary, results)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [run.runId, deviceId, run.trigger, run.stage ?? null, run.startedAt, run.finishedAt, json(summary), json(run.results)],
      );
      if (!ins.length) return { duplicate: true };
      for (const r of run.results) {
        await q.query(
          `INSERT INTO latest_results (device_id, rule_id, result, checked_at) VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (device_id, rule_id) DO UPDATE SET result = excluded.result, checked_at = excluded.checked_at
           WHERE latest_results.checked_at <= excluded.checked_at`,
          [deviceId, r.ruleId, json(r), r.checkedAt],
        );
      }
      return { duplicate: false };
    });
  }

  async finishJob(deviceId: string, jobId: string, r: { status: string; exitCode: number | null; stdout: string; stderr: string }) {
    const rows = await this.db.query<{ id: string; script_id: string }>(
      `UPDATE jobs SET status = $3, exit_code = $4, stdout = $5, stderr = $6, finished_at = now()
       WHERE id = $1 AND device_id = $2 AND status IN ('dispatched', 'running') RETURNING id, script_id`,
      [jobId, deviceId, r.status, r.exitCode, r.stdout, r.stderr],
    );
    return rows[0] ?? null;
  }

  private async expireJobs(q: Queryable) {
    await q.query(
      `UPDATE jobs SET status = 'timed_out', finished_at = now()
       WHERE status IN ('dispatched', 'running') AND dispatched_at < now() - ${JOB_DISPATCH_TIMEOUT}`,
    );
  }

  // ---------- dashboard ----------

  private toIdentity(d: Record<string, unknown>): DeviceIdentity {
    return {
      id: d.id as string,
      assetTag: d.asset_tag as string,
      serial: d.serial as string,
      hostname: d.hostname as string,
      model: d.model as string,
      agentVersion: d.agent_version as string,
      osBuild: d.os_build as string,
      lastSeenAt: iso(d.last_seen_at),
      telemetry: (d.telemetry as DeviceIdentity['telemetry']) ?? {},
    };
  }

  private async attestationsFor(deviceIds: string[] | null): Promise<Map<string, AttestationView[]>> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT id, device_id, item_id, rule_id, by_user, at, note FROM attestations
       WHERE revoked_at IS NULL ${deviceIds ? 'AND device_id = ANY($1::uuid[])' : ''} ORDER BY at`,
      deviceIds ? [deviceIds] : [],
    );
    const m = new Map<string, AttestationView[]>();
    for (const r of rows) {
      const a: AttestationView = {
        id: r.id as string,
        ...(r.item_id ? { itemId: r.item_id as string } : { ruleId: r.rule_id as string }),
        by: r.by_user as string,
        at: iso(r.at)!,
        ...(r.note ? { note: r.note as string } : {}),
      };
      m.set(r.device_id as string, [...(m.get(r.device_id as string) ?? []), a]);
    }
    return m;
  }

  private async resultsFor(deviceIds: string[] | null): Promise<Map<string, Result[]>> {
    const rows = await this.db.query<{ device_id: string; result: unknown }>(
      `SELECT device_id, result FROM latest_results ${deviceIds ? 'WHERE device_id = ANY($1::uuid[])' : ''}`,
      deviceIds ? [deviceIds] : [],
    );
    const m = new Map<string, Result[]>();
    for (const r of rows) {
      const parsed = Result.safeParse(r.result);
      if (parsed.success) m.set(r.device_id, [...(m.get(r.device_id) ?? []), parsed.data]);
    }
    return m;
  }

  async listDevices(): Promise<DeviceSummary[]> {
    const [{ rules }, items, devices] = await Promise.all([
      this.rules(),
      this.manualItems(),
      this.db.query<Record<string, unknown>>('SELECT * FROM devices ORDER BY asset_tag'),
    ]);
    const [results, atts] = await Promise.all([this.resultsFor(null), this.attestationsFor(null)]);
    const now = new Date();
    return devices.map((d) =>
      summarizeDevice(this.toIdentity(d), rules, results.get(d.id as string) ?? [], items, atts.get(d.id as string) ?? [], now),
    );
  }

  async deviceDetail(id: string): Promise<DeviceDetail | null> {
    const dev = (await this.db.query<Record<string, unknown>>('SELECT * FROM devices WHERE id = $1', [id]))[0];
    if (!dev) return null;
    await this.expireJobs(this.db);
    const [{ rules }, items, results, atts, jobs, lastRun] = await Promise.all([
      this.rules(),
      this.manualItems(),
      this.resultsFor([id]),
      this.attestationsFor([id]),
      this.jobs(id, 20),
      this.db.query<{ finished_at: string }>('SELECT finished_at FROM runs WHERE device_id = $1 ORDER BY finished_at DESC LIMIT 1', [id]),
    ]);
    const now = new Date();
    const res = results.get(id) ?? [];
    const attestations = atts.get(id) ?? [];
    const summary = summarizeDevice(this.toIdentity(dev), rules, res, items, attestations, now);
    return {
      ...summary,
      rules,
      results: withSyntheticResults(rules, res, now),
      manualItems: items,
      attestations,
      jobs,
      lastRunAt: iso(lastRun[0]?.finished_at),
    };
  }

  async runs(deviceId: string, limit = 50) {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT id, trigger, stage, started_at, finished_at, summary FROM runs WHERE device_id = $1 ORDER BY finished_at DESC LIMIT $2',
      [deviceId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      stage: r.stage,
      startedAt: iso(r.started_at),
      finishedAt: iso(r.finished_at),
      summary: r.summary,
    }));
  }

  async run(runId: string) {
    const r = (await this.db.query<Record<string, unknown>>('SELECT * FROM runs WHERE id = $1', [runId]))[0];
    return r ? { id: r.id, deviceId: r.device_id, trigger: r.trigger, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), results: r.results } : null;
  }

  async deviceExists(id: string): Promise<boolean> {
    return (await this.db.query('SELECT 1 FROM devices WHERE id = $1', [id])).length > 0;
  }

  async requestRun(deviceId: string, stage?: string) {
    await this.db.query('UPDATE devices SET run_request = $2::jsonb WHERE id = $1', [deviceId, json(stage ? { stage } : {})]);
  }

  async attest(deviceId: string, a: { itemId?: string; ruleId?: string; note?: string }, by: string): Promise<AttestationView> {
    // one active attestation per target: revoke any previous one first
    await this.db.query(
      `UPDATE attestations SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL
       AND ((item_id IS NOT NULL AND item_id = $2) OR (rule_id IS NOT NULL AND rule_id = $3))`,
      [deviceId, a.itemId ?? null, a.ruleId ?? null],
    );
    const id = randomUUID();
    const rows = await this.db.query<{ at: string }>(
      'INSERT INTO attestations (id, device_id, item_id, rule_id, by_user, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING at',
      [id, deviceId, a.itemId ?? null, a.ruleId ?? null, by, a.note ?? null],
    );
    return { id, ...(a.itemId ? { itemId: a.itemId } : { ruleId: a.ruleId }), by, at: iso(rows[0]!.at)!, ...(a.note ? { note: a.note } : {}) };
  }

  async revokeAttestation(deviceId: string, attId: string): Promise<boolean> {
    const r = await this.db.query(
      'UPDATE attestations SET revoked_at = now() WHERE id = $1 AND device_id = $2 AND revoked_at IS NULL RETURNING id',
      [attId, deviceId],
    );
    return r.length > 0;
  }

  async createJob(deviceId: string, scriptId: string, params: Record<string, unknown>, ruleId: string | undefined, by: string): Promise<JobView> {
    const id = randomUUID();
    const rows = await this.db.query<{ created_at: string }>(
      `INSERT INTO jobs (id, device_id, script_id, params, rule_id, status, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'queued', $6) RETURNING created_at`,
      [id, deviceId, scriptId, json(params), ruleId ?? null, by],
    );
    return { id, scriptId, ...(ruleId ? { ruleId } : {}), status: 'queued', createdBy: by, createdAt: iso(rows[0]!.created_at)! };
  }

  async jobs(deviceId: string, limit = 20): Promise<JobView[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM jobs WHERE device_id = $1 ORDER BY created_at DESC LIMIT $2',
      [deviceId, limit],
    );
    return rows.map((j) => this.toJob(j));
  }

  async job(id: string): Promise<JobView | null> {
    await this.expireJobs(this.db);
    const j = (await this.db.query<Record<string, unknown>>('SELECT * FROM jobs WHERE id = $1', [id]))[0];
    return j ? this.toJob(j) : null;
  }

  private toJob(j: Record<string, unknown>): JobView {
    return {
      id: j.id as string,
      scriptId: j.script_id as string,
      ...(j.rule_id ? { ruleId: j.rule_id as string } : {}),
      status: j.status as JobView['status'],
      createdBy: j.created_by as string,
      createdAt: iso(j.created_at)!,
      finishedAt: iso(j.finished_at),
      exitCode: (j.exit_code as number | null) ?? null,
      stdout: (j.stdout as string | null) ?? null,
      stderr: (j.stderr as string | null) ?? null,
    };
  }

  // ---------- audit ----------

  async audit(actor: string, action: string, target: string | null, detail: Record<string, unknown> = {}) {
    await this.db.query('INSERT INTO audit_log (actor, action, target, detail) VALUES ($1, $2, $3, $4::jsonb)', [actor, action, target, json(detail)]);
  }

  async auditLog(limit = 200) {
    const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM audit_log ORDER BY id DESC LIMIT $1', [limit]);
    return rows.map((r) => ({ id: Number(r.id), at: iso(r.at), actor: r.actor, action: r.action, target: r.target, detail: r.detail }));
  }
}
