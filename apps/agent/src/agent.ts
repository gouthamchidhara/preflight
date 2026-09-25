/**
 * The agent service loop (§3, §6.4, §7):
 *   enroll once → every 15 s check in (heartbeat + work) → run checks at start (+2 min)
 *   and hourly → queue results on disk → upload when the server is reachable.
 * Everything outbound; nothing listens on the UMD.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { Job, Result, Run, Rule } from '@umd/contracts';
import { ApiClient, HttpError } from './api.js';
import type { AgentConfig } from './config.js';
import { getIdentity } from './identity.js';
import { executeJob, type JobOutcome } from './jobs.js';
import type { Logger } from './log.js';
import { currentPolicy, savePolicy, selectRules } from './policy.js';
import type { DiskQueue } from './queue.js';
import { runRules } from './runner.js';
import type { Shell } from './shell.js';

export type QueueBody = { kind: 'run'; run: Run } | { kind: 'job'; jobId: string; result: JobOutcome };

export interface AgentDeps {
  version: string;
  config: AgentConfig;
  saveConfig: (c: AgentConfig) => void;
  loadKey: () => string | null;
  saveKey: (k: string) => void;
  shell: Shell;
  queue: DiskQueue<QueueBody>;
  log: Logger;
  checksDir: string;
  scriptsDir: string;
  backupDir: string;
  lastRunFile?: string;
  api?: ApiClient;
}

type Trigger = Run['trigger'];

export class AgentService {
  private api: ApiClient | null;
  private key: string | null;
  private policyVersion = -1;
  private runs = 0;

  constructor(private d: AgentDeps) {
    this.key = d.loadKey();
    this.api = d.api ?? (d.config.serverUrl ? new ApiClient(d.config.serverUrl, () => this.key) : null);
  }

  get enrolled() {
    return !!this.key;
  }

  /** Run rules locally, queue the run, try to upload. Never throws. */
  async runChecks(trigger: Trigger, filter: { stage?: Rule['stage']; ruleIds?: string[] } = {}): Promise<Run> {
    const rules = selectRules(currentPolicy().rules, filter);
    const startedAt = new Date().toISOString();
    this.d.log.info('run start', { trigger, stage: filter.stage, rules: rules.length });
    const results: Result[] = await runRules(rules, { shell: this.d.shell, checksDir: this.d.checksDir });
    const run: Run = { runId: randomUUID(), trigger, ...(filter.stage ? { stage: filter.stage } : {}), startedAt, finishedAt: new Date().toISOString(), results };
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
    this.d.log.info('run done', { runId: run.runId, ...counts });
    if (this.d.lastRunFile) {
      try {
        writeFileSync(this.d.lastRunFile, JSON.stringify(run, null, 2));
      } catch {
        /* best effort */
      }
    }
    if (this.api) {
      this.d.queue.push('run', { kind: 'run', run });
      await this.flush();
    }
    this.runs++;
    return run;
  }

  async ensureEnrolled(): Promise<boolean> {
    if (this.key) return true;
    const { config } = this.d;
    if (!this.api || !config.bootstrapToken) {
      this.d.log.warn('not enrolled: set serverUrl + bootstrapToken (PreflightAgent enroll --server … --token …)');
      return false;
    }
    const id = await getIdentity(this.d.shell, this.d.checksDir, true);
    const out = await this.api.enroll({ bootstrapToken: config.bootstrapToken, hostname: id.hostname, serial: id.serial, assetTag: id.assetTag, model: id.model });
    this.d.saveKey(out.deviceKey);
    this.key = out.deviceKey;
    // the bootstrap token is not kept on disk once this device has its own key
    const next = { ...config, deviceId: out.deviceId };
    delete next.bootstrapToken;
    this.d.saveConfig(next);
    this.d.log.info('enrolled', { deviceId: out.deviceId, serial: id.serial });
    return true;
  }

  /** Upload queued runs/job results oldest-first. Stops at the first network error. */
  async flush(): Promise<number> {
    if (!this.api || !this.key) return 0;
    let sent = 0;
    for (const item of this.d.queue.list()) {
      try {
        if (item.body.kind === 'run') await this.api.postRun(item.body.run);
        else await this.api.postJobResult(item.body.jobId, item.body.result);
        this.d.queue.remove(item.name);
        sent++;
      } catch (e) {
        if (e instanceof HttpError && (e.status === 400 || e.status === 404 || e.status === 409)) {
          // the server will never accept this item; drop it rather than block the queue forever
          this.d.log.error('dropping rejected queue item', { name: item.name, status: e.status, msg: e.message });
          this.d.queue.remove(item.name);
          continue;
        }
        this.d.log.warn('upload paused', { msg: (e as Error).message, pending: this.d.queue.size() });
        break;
      }
    }
    return sent;
  }

  /** One heartbeat: telemetry up, work down. */
  async tick(): Promise<void> {
    if (!this.api) return;
    if (!(await this.ensureEnrolled())) return;
    const id = await getIdentity(this.d.shell, this.d.checksDir);
    const res = await this.api.checkin({
      agentVersion: this.d.version,
      osBuild: id.osBuild,
      uptimeSec: Math.round(process.uptime()),
      onAC: id.onAC,
      lanUp: id.lanUp,
      wwanReady: id.wwanReady,
    });
    if (res.policyVersion !== this.policyVersion) {
      const p = await this.api.policy();
      savePolicy(p);
      this.policyVersion = p.policyVersion;
      this.d.log.info('policy updated', { policyVersion: p.policyVersion, rules: p.rules.length });
    }
    if (res.runNow) await this.runChecks('manual', { stage: res.runNow.stage });
    for (const job of res.jobs) await this.handleJob(job);
    await this.flush();
  }

  async handleJob(job: Job) {
    this.d.log.info('job start', { jobId: job.id, scriptId: job.scriptId });
    const outcome = await executeJob(job, { shell: this.d.shell, scriptsDir: this.d.scriptsDir, backupDir: this.d.backupDir });
    this.d.log.info('job done', { jobId: job.id, status: outcome.status, exitCode: outcome.exitCode });
    this.d.queue.push('job', { kind: 'job', jobId: job.id, result: outcome });
    await this.flush();
    // §7: re-check the rule the fix was for, so the dashboard updates right away
    if (job.ruleId && outcome.status === 'succeeded') await this.runChecks('remediation', { ruleIds: [job.ruleId] });
  }

  /** Foreground service loop; resolves when `signal` aborts. */
  async serve(signal: AbortSignal): Promise<void> {
    const { config, log } = this.d;
    log.info('service start', { version: this.d.version, server: config.serverUrl ?? '(offline)', enrolled: this.enrolled });
    let nextRunAt = Date.now() + config.startupDelaySec * 1000;
    let delay = config.checkinSec;
    while (!signal.aborted) {
      if (Date.now() >= nextRunAt) {
        await this.runChecks(this.runs === 0 ? 'startup' : 'schedule');
        nextRunAt = Date.now() + config.scheduleMin * 60_000;
      }
      try {
        await this.tick();
        delay = config.checkinSec;
      } catch (e) {
        delay = Math.min(delay * 2, 600);
        log.warn('checkin failed', { msg: (e as Error).message, retryInSec: delay });
      }
      await sleep(Math.min(delay * 1000, Math.max(1000, nextRunAt - Date.now())), signal);
    }
    log.info('service stop');
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
