/**
 * Wire contracts shared by agent, API and web (PLAN.md §5).
 * Every payload crossing a process boundary is parsed with one of these.
 */
import { z } from 'zod';

export const STAGES = ['image', 'config', 'hardware', 'bios', 'register'] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;

/** Stages the agent can check. `register` is manual-only (§1). */
export const RuleStage = z.enum(['image', 'config', 'hardware', 'bios']);

export const Severity = z.enum(['critical', 'warn']);
export type Severity = z.infer<typeof Severity>;

export const ResultStatus = z.enum(['pass', 'fail', 'error', 'skip', 'needs_human']);
export type ResultStatus = z.infer<typeof ResultStatus>;

export const SkipReason = z.enum(['not_applicable', 'precondition']);
export type SkipReason = z.infer<typeof SkipReason>;

/** Stable dotted slug, e.g. `disk.data.present` (§6.1). */
export const RuleId = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/, 'rule id must be a dotted slug');
/** Whitelisted script id, e.g. `lsapl-restore-file` (§7). */
export const ScriptId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'script id must be kebab-case');

export const Remediation = z.object({
  scriptId: ScriptId,
  params: z.record(z.unknown()).default({}),
  auto: z.boolean().default(false),
});
export type Remediation = z.infer<typeof Remediation>;

export const Rule = z.object({
  id: RuleId,
  name: z.string().min(1),
  stage: RuleStage,
  type: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  severity: Severity,
  timeoutMs: z.number().int().min(100).max(300_000).default(10_000),
  remediation: Remediation.optional(),
  hint: z.string().optional(),
});
export type Rule = z.infer<typeof Rule>;

const EVIDENCE_MAX_BYTES = 8 * 1024;

export const Result = z
  .object({
    ruleId: RuleId,
    status: ResultStatus,
    skipReason: SkipReason.nullable().default(null),
    expected: z.unknown().optional(),
    actual: z.unknown().optional(),
    evidence: z
      .record(z.unknown())
      .default({})
      .refine((e) => JSON.stringify(e).length <= EVIDENCE_MAX_BYTES, 'evidence exceeds 8 KB'),
    durationMs: z.number().int().nonnegative(),
    checkedAt: z.string().datetime(),
  })
  .superRefine((r, ctx) => {
    if (r.status === 'skip' && !r.skipReason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'skip requires skipReason', path: ['skipReason'] });
    }
    if (r.status !== 'skip' && r.skipReason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'skipReason only valid with skip', path: ['skipReason'] });
    }
  });
export type Result = z.infer<typeof Result>;

export const RunTrigger = z.enum(['startup', 'schedule', 'manual', 'remediation']);

export const Run = z.object({
  runId: z.string().uuid(),
  trigger: RunTrigger,
  stage: RuleStage.optional(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  results: z.array(Result).max(500),
});
export type Run = z.infer<typeof Run>;

export const Enroll = z.object({
  bootstrapToken: z.string().min(16),
  hostname: z.string().min(1).max(64),
  serial: z.string().min(1).max(64),
  assetTag: z.string().max(64),
  model: z.string().max(128),
});

export const EnrollResponse = z.object({
  deviceId: z.string().uuid(),
  deviceKey: z.string().min(32),
});

export const Checkin = z.object({
  agentVersion: z.string(),
  osBuild: z.string(),
  uptimeSec: z.number().int().nonnegative(),
  onAC: z.boolean(),
  lanUp: z.boolean(),
  wwanReady: z.boolean(),
});
export type Checkin = z.infer<typeof Checkin>;

export const JobStatus = z.enum(['queued', 'dispatched', 'running', 'succeeded', 'failed', 'timed_out']);
export type JobStatus = z.infer<typeof JobStatus>;

export const Job = z.object({
  id: z.string().uuid(),
  scriptId: ScriptId,
  params: z.record(z.unknown()).default({}),
  status: JobStatus,
  createdAt: z.string().datetime(),
});
export type Job = z.infer<typeof Job>;

const OUTPUT_MAX = 64 * 1024;
export const JobResult = z.object({
  status: z.enum(['succeeded', 'failed', 'timed_out']),
  exitCode: z.number().int().nullable(),
  stdout: z.string().max(OUTPUT_MAX),
  stderr: z.string().max(OUTPUT_MAX),
});

export const CheckinResponse = z.object({
  policyVersion: z.number().int().nonnegative(),
  jobs: z.array(Job),
  runNow: z.union([z.literal(false), z.object({ stage: RuleStage.optional() })]),
});

export const Policy = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int().nonnegative(),
  rules: z.array(Rule),
});
export type Policy = z.infer<typeof Policy>;

export const ManualItem = z.object({
  id: RuleId,
  stage: Stage,
  label: z.string().min(1),
});
export type ManualItem = z.infer<typeof ManualItem>;

export const Attestation = z
  .object({
    itemId: RuleId.optional(),
    ruleId: RuleId.optional(),
    by: z.string().min(1),
    at: z.string().datetime(),
    note: z.string().max(500).optional(),
  })
  .refine((a) => Boolean(a.itemId) !== Boolean(a.ruleId), 'exactly one of itemId or ruleId');
export type Attestation = z.infer<typeof Attestation>;
