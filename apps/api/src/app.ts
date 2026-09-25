/**
 * Fastify app: agent API (§5.4 agent), user API (§5.4 user), dashboard static files.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import type { JWTVerifyGetKey } from 'jose';
import {
  Checkin,
  Enroll,
  JobResult,
  Rule,
  RuleId,
  RuleStage,
  Run,
  SCRIPT_CATALOG,
  validateScriptParams,
  type Golden,
} from '@umd/contracts';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { Repo } from './repo.js';
import { deviceFromKey, makeUserAuth, requireRole, sha256 } from './auth.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadGolden(path?: string): Golden {
  const candidates = path
    ? [path]
    : [resolve(process.cwd(), 'golden/manifest.json'), resolve(process.cwd(), '../../golden/manifest.json'), resolve(HERE, '../../../golden/manifest.json')];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`golden manifest not found (tried ${candidates.join(', ')})`);
  return JSON.parse(readFileSync(found, 'utf8')) as Golden;
}

export interface AppOptions {
  cfg: Config;
  db: Db;
  golden: Golden;
  /** Tests inject a local JWKS instead of Microsoft's. */
  jwks?: JWTVerifyGetKey;
  logger?: boolean;
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | undefined {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  void reply.code(400).send({ error: 'invalid body', issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  return undefined;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { cfg, db, golden } = opts;
  const app = Fastify({
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
    logger:
      opts.logger === false
        ? false
        : { level: cfg.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers["x-device-key"]'] },
  });
  const repo = new Repo(db, golden);
  await repo.seed();
  if (cfg.BOOTSTRAP_TOKEN) await repo.ensureBootstrapToken(cfg.BOOTSTRAP_TOKEN);
  const authenticate = makeUserAuth(cfg, opts.jwks);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://login.microsoftonline.com; frame-src https://login.microsoftonline.com",
    );
  });

  if (cfg.RATE_LIMIT === 'on') {
    await app.register(rateLimit, {
      max: 300,
      timeWindow: '1 minute',
      keyGenerator: (req) => {
        const k = req.headers['x-device-key'];
        return typeof k === 'string' ? `dev:${sha256(k).slice(0, 16)}` : `ip:${req.ip}`;
      },
    });
  }

  app.get('/healthz', async () => {
    await db.query('SELECT 1');
    return { ok: true, db: db.kind };
  });

  // ------------------------------------------------------------------ agent API
  await app.register(async (agent) => {
    const deviceAuth = async (req: FastifyRequest, reply: FastifyReply) => {
      const id = await deviceFromKey(db, req.headers['x-device-key'] as string | undefined);
      if (!id) return reply.code(401).send({ error: 'bad device key' });
      req.deviceId = id;
    };

    agent.post('/enroll', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const body = parse(Enroll, req.body, reply);
      if (!body) return;
      const out = await repo.enroll(body);
      if (!out) {
        await repo.audit(`ip:${req.ip}`, 'device.enroll.denied', body.serial, { hostname: body.hostname });
        return reply.code(401).send({ error: 'enrollment token invalid, expired or used up' });
      }
      await repo.audit(`device:${out.deviceId}`, out.reEnrolled ? 'device.reenroll' : 'device.enroll', out.deviceId, {
        serial: body.serial,
        assetTag: body.assetTag,
        hostname: body.hostname,
      });
      return { deviceId: out.deviceId, deviceKey: out.deviceKey };
    });

    agent.post('/checkin', { preHandler: deviceAuth }, async (req, reply) => {
      const body = parse(Checkin, req.body, reply);
      if (!body) return;
      const [{ policyVersion }, work] = await Promise.all([repo.agentPolicy(), repo.checkin(req.deviceId!, body)]);
      return { policyVersion, jobs: work.jobs, runNow: work.runNow };
    });

    agent.get('/policy', { preHandler: deviceAuth }, async () => repo.agentPolicy());

    agent.post('/runs', { preHandler: deviceAuth }, async (req, reply) => {
      const body = parse(Run, req.body, reply);
      if (!body) return;
      const out = await repo.ingestRun(req.deviceId!, body);
      return { ok: true, ...out };
    });

    agent.post<{ Params: { id: string } }>('/jobs/:id/result', { preHandler: deviceAuth }, async (req, reply) => {
      if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'no such job' });
      const body = parse(JobResult, req.body, reply);
      if (!body) return;
      const job = await repo.finishJob(req.deviceId!, req.params.id, body);
      if (!job) return reply.code(409).send({ error: 'job not dispatched to this device' });
      await repo.audit(`device:${req.deviceId}`, 'job.finish', req.params.id, { scriptId: job.script_id, status: body.status, exitCode: body.exitCode });
      return { ok: true };
    });
  }, { prefix: '/api/agent/v1' });

  // ------------------------------------------------------------------ user API
  app.get('/api/v1/config', async () => ({
    authMode: cfg.AUTH_MODE,
    tenantId: cfg.ENTRA_TENANT_ID ?? null,
    clientId: cfg.ENTRA_CLIENT_ID ?? null,
    apiScope: cfg.ENTRA_API_SCOPE ?? null,
  }));

  await app.register(async (user) => {
    user.addHook('preHandler', async (req, reply) => {
      const u = await authenticate(req);
      if (!u) {
        await repo.audit(`ip:${req.ip}`, 'auth.denied', req.url);
        return reply.code(401).send({ error: 'unauthorized' });
      }
      req.user = u;
    });

    const deviceParam = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!UUID.test(req.params.id) || !(await repo.deviceExists(req.params.id))) return reply.code(404).send({ error: 'no such device' });
    };

    user.get('/me', async (req) => req.user);

    user.get('/devices', { preHandler: requireRole('Viewer') }, async () => repo.listDevices());

    user.get<{ Params: { id: string } }>('/devices/:id', { preHandler: [requireRole('Viewer'), deviceParam] }, async (req) =>
      repo.deviceDetail(req.params.id),
    );

    user.get<{ Params: { id: string } }>('/devices/:id/runs', { preHandler: [requireRole('Viewer'), deviceParam] }, async (req) =>
      repo.runs(req.params.id),
    );

    user.get<{ Params: { id: string } }>('/runs/:id', { preHandler: requireRole('Viewer') }, async (req, reply) => {
      const r = UUID.test(req.params.id) ? await repo.run(req.params.id) : null;
      return r ?? reply.code(404).send({ error: 'no such run' });
    });

    user.post<{ Params: { id: string } }>('/devices/:id/run', { preHandler: [requireRole('Tech'), deviceParam] }, async (req, reply) => {
      const body = parse(z.object({ stage: RuleStage.optional() }).strict(), req.body ?? {}, reply);
      if (!body) return;
      await repo.requestRun(req.params.id, body.stage);
      await repo.audit(req.user!.name, 'device.run', req.params.id, body);
      return { ok: true, note: 'Agent picks this up at its next check-in (≤15 s).' };
    });

    user.post<{ Params: { id: string } }>('/devices/:id/attestations', { preHandler: [requireRole('Tech'), deviceParam] }, async (req, reply) => {
      const body = parse(
        z
          .object({ itemId: RuleId.optional(), ruleId: RuleId.optional(), note: z.string().max(500).optional() })
          .strict()
          .refine((a) => Boolean(a.itemId) !== Boolean(a.ruleId), 'exactly one of itemId or ruleId'),
        req.body,
        reply,
      );
      if (!body) return;
      const [{ rules }, items] = await Promise.all([repo.rules(), repo.manualItems()]);
      const known = body.itemId ? items.some((i) => i.id === body.itemId) : rules.some((r) => r.id === body.ruleId);
      if (!known) return reply.code(400).send({ error: 'unknown itemId/ruleId' });
      const a = await repo.attest(req.params.id, body, req.user!.name);
      await repo.audit(req.user!.name, 'attestation.add', req.params.id, { ...body, attestationId: a.id });
      return a;
    });

    user.delete<{ Params: { id: string; attId: string } }>(
      '/devices/:id/attestations/:attId',
      { preHandler: [requireRole('Tech'), deviceParam] },
      async (req, reply) => {
        if (!UUID.test(req.params.attId) || !(await repo.revokeAttestation(req.params.id, req.params.attId))) {
          return reply.code(404).send({ error: 'no such attestation' });
        }
        await repo.audit(req.user!.name, 'attestation.revoke', req.params.id, { attestationId: req.params.attId });
        return { ok: true };
      },
    );

    user.post<{ Params: { id: string } }>('/devices/:id/jobs', { preHandler: [requireRole('Tech'), deviceParam] }, async (req, reply) => {
      const body = parse(
        z.object({ scriptId: z.string(), params: z.record(z.unknown()).default({}), ruleId: RuleId.optional() }).strict(),
        req.body,
        reply,
      );
      if (!body) return;
      const v = validateScriptParams(body.scriptId, body.params);
      if (!v.ok) {
        await repo.audit(req.user!.name, 'job.rejected', req.params.id, { scriptId: body.scriptId, error: v.error });
        return reply.code(400).send({ error: v.error });
      }
      const job = await repo.createJob(req.params.id, body.scriptId, v.params, body.ruleId, req.user!.name);
      await repo.audit(req.user!.name, 'job.create', req.params.id, { jobId: job.id, scriptId: body.scriptId, params: v.params, ruleId: body.ruleId });
      return job;
    });

    user.get<{ Params: { id: string } }>('/jobs/:id', { preHandler: requireRole('Viewer') }, async (req, reply) => {
      const j = UUID.test(req.params.id) ? await repo.job(req.params.id) : null;
      return j ?? reply.code(404).send({ error: 'no such job' });
    });

    user.get('/policy', { preHandler: requireRole('Viewer') }, async () => {
      const [{ version, rules }, items] = await Promise.all([repo.rules(), repo.manualItems()]);
      return { version, rules, manualItems: items };
    });

    user.put('/policy', { preHandler: requireRole('Admin') }, async (req, reply) => {
      const body = parse(z.object({ rules: z.array(Rule).min(1) }).strict(), req.body, reply);
      if (!body) return;
      const ids = body.rules.map((r) => r.id);
      if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: 'duplicate rule ids' });
      for (const r of body.rules) {
        if (r.remediation && !validateScriptParams(r.remediation.scriptId, r.remediation.params).ok) {
          return reply.code(400).send({ error: `rule ${r.id}: remediation not whitelisted` });
        }
      }
      const version = await repo.setRules(body.rules, req.user!.name);
      await repo.audit(req.user!.name, 'policy.update', 'default', { version, ruleCount: body.rules.length });
      return { version };
    });

    user.get('/scripts', { preHandler: requireRole('Viewer') }, async () =>
      Object.entries(SCRIPT_CATALOG).map(([id, s]) => ({ id, label: s.label, confirm: s.confirm })),
    );

    user.get('/audit', { preHandler: requireRole('Admin') }, async () => repo.auditLog());

    user.post('/enrollment-tokens', { preHandler: requireRole('Admin') }, async (req, reply) => {
      const body = parse(
        z.object({ label: z.string().min(1).max(100), maxUses: z.number().int().min(1).max(100000), expiresInDays: z.number().int().min(1).max(365) }).strict(),
        req.body,
        reply,
      );
      if (!body) return;
      const token = await repo.createEnrollmentToken(body.label, body.maxUses, new Date(Date.now() + body.expiresInDays * 864e5), req.user!.name);
      await repo.audit(req.user!.name, 'enrollment-token.create', body.label, { maxUses: body.maxUses, expiresInDays: body.expiresInDays });
      return { token, note: 'Shown once. Put it in the SCCM package; it is stored hashed.' };
    });
  }, { prefix: '/api/v1' });

  // ------------------------------------------------------------------ dashboard
  const webDist = cfg.WEB_DIST ?? resolve(HERE, '../../web/dist');
  if (existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
