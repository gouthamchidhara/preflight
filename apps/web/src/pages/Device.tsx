import { useState } from 'react';
import { STAGES, type AttestationView, type DeviceDetail, type JobView, type Result, type Rule, type Stage } from '@umd/contracts';
import { ArrowLeft, Check, Copy, Network, Plug, RefreshCw, Signal, Wrench } from 'lucide-react';
import { STAGE_LABEL, show, timeAgo } from '../lib/format.js';
import { usePoll } from '../lib/usePoll.js';
import { useSource } from '../lib/context.js';
import { Badge, READINESS, RESULT, STAGE_STATE } from '../components/status.js';
import { StageBar } from '../components/StageBar.js';
import { Banner } from '../components/Banner.js';

type RowState = keyof typeof RESULT;

function rowState(result: Result | undefined, attested: boolean): RowState {
  if (attested) return 'attested';
  if (!result) return 'pending';
  if (result.status === 'skip' && result.skipReason === 'precondition') return 'pending';
  return result.status;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="flex items-center gap-1.5">
        <span className="truncate font-mono text-sm">{value || '—'}</span>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded p-1 text-ink-3 hover:bg-page hover:text-ink"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </dd>
    </div>
  );
}

function Chip({ ok, icon: Icon, label }: { ok: boolean | undefined; icon: typeof Plug; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs ${ok ? 'text-ink-2' : 'text-ink-3 line-through'}`}>
      <Icon size={13} aria-hidden />
      {label}
      <span className="sr-only">{ok ? 'up' : 'down'}</span>
    </span>
  );
}

const JOB_TONE: Record<JobView['status'], string> = {
  queued: 'text-ink-2',
  dispatched: 'text-accent',
  running: 'text-accent',
  succeeded: 'text-good-ink',
  failed: 'text-critical-ink',
  timed_out: 'text-critical-ink',
};

function RuleRow({ rule, result, attestation, busy, onAttest, onRevoke, onFix }: {
  rule: Rule;
  result: Result | undefined;
  attestation: AttestationView | undefined;
  busy: boolean;
  onAttest: () => void;
  onRevoke: () => void;
  onFix: () => void;
}) {
  const state = rowState(result, Boolean(attestation));
  const failing = state === 'fail' || state === 'error';
  const detail = failing || state === 'needs_human' || state === 'pending' || state === 'skip';
  return (
    <li className={`grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[8.5rem_1fr_auto] ${failing ? 'bg-critical/5' : ''}`}>
      <div className="pt-0.5">
        <Badge tone={RESULT[state]} />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{rule.name}</span>
          <span className="font-mono text-xs text-ink-3">{rule.id}</span>
          {rule.severity === 'warn' && <span className="text-xs text-ink-3">· warn</span>}
        </div>
        {detail && (
          <dl className="mt-1 grid gap-x-3 text-sm sm:grid-cols-[5rem_1fr]">
            <dt className="text-ink-3">Expected</dt>
            <dd className="break-words font-mono text-xs leading-5 text-ink-2">{show(result?.expected)}</dd>
            <dt className="text-ink-3">Actual</dt>
            <dd className={`break-words font-mono text-xs leading-5 ${failing ? 'text-critical-ink' : 'text-ink-2'}`}>{show(result?.actual)}</dd>
          </dl>
        )}
        {(failing || state === 'needs_human') && rule.hint && <p className="mt-1.5 text-sm text-ink-2">→ {rule.hint}</p>}
        {attestation && (
          <p className="mt-1 text-xs text-ink-3">
            {state === 'attested' && result?.status === 'fail' ? 'Accepted' : 'Attested'} by {attestation.by} · {timeAgo(attestation.at)}
            {attestation.note && ` · “${attestation.note}”`}
            <button type="button" onClick={onRevoke} disabled={busy} className="ml-2 text-accent hover:underline disabled:opacity-50">
              undo
            </button>
          </p>
        )}
      </div>
      <div className="flex items-start gap-2 sm:justify-end">
        {failing && rule.remediation && !attestation && (
          <button
            type="button"
            onClick={onFix}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
          >
            <Wrench size={14} aria-hidden /> Run fix
          </button>
        )}
        {(state === 'needs_human' || failing) && !attestation && (
          <button
            type="button"
            onClick={onAttest}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:border-ink-3 hover:text-ink disabled:opacity-50"
          >
            {failing ? 'Accept' : 'Attest'}
          </button>
        )}
      </div>
    </li>
  );
}

export interface DeviceActions {
  busy: boolean;
  attestRule: (ruleId: string) => void;
  toggleItem: (itemId: string, existing?: AttestationView) => void;
  revoke: (attId: string) => void;
  fix: (rule: Rule) => void;
  runAll: () => void;
}

export function DeviceView({ d, actions, onBack, optimistic = {} }: { d: DeviceDetail; actions: DeviceActions; onBack: () => void; optimistic?: Record<string, boolean> }) {
  const [issuesOnly, setIssuesOnly] = useState(false);
  const byRule = new Map(d.results.map((r) => [r.ruleId, r]));
  const attByRule = new Map(d.attestations.filter((a) => a.ruleId).map((a) => [a.ruleId!, a]));
  const attByItem = new Map(d.attestations.filter((a) => a.itemId).map((a) => [a.itemId!, a]));

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft size={16} aria-hidden /> Fleet
      </button>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{d.assetTag || d.hostname}</h1>
            <Badge tone={READINESS[d.display]} size="base" />
          </div>
          <p className="mt-1 text-sm text-ink-2">
            {d.hostname} · {d.model} · agent {d.agentVersion || '—'} · last check-in {timeAgo(d.lastSeenAt)} · last run {timeAgo(d.lastRunAt)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip ok={d.telemetry.onAC} icon={Plug} label="On AC" />
            <Chip ok={d.telemetry.lanUp} icon={Network} label="LAN" />
            <Chip ok={d.telemetry.wwanReady} icon={Signal} label="Cellular" />
          </div>
        </div>
        <button
          type="button"
          onClick={actions.runAll}
          disabled={actions.busy}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw size={16} aria-hidden /> Run all checks
        </button>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-ink-2">Lifecycle</h2>
          <StageBar stages={d.stages} criticalStage={d.criticalStage} />
          <div className="mt-2 grid grid-cols-5 gap-0.5">
            {STAGES.map((s) => (
              <a key={s} href={`#stage-${s}`} onClick={(e) => { e.preventDefault(); document.getElementById(`stage-${s}`)?.scrollIntoView({ behavior: 'smooth' }); }} className="min-w-0 hover:underline">
                <span className="block truncate text-sm text-ink">{STAGE_LABEL[s]}</span>
                <Badge tone={STAGE_STATE[d.stages[s]]} size="xs" />
              </a>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4">
          <CopyField label="Asset tag (EID)" value={d.assetTag} />
          <CopyField label="Serial" value={d.serial} />
          <CopyField label="Host" value={d.hostname} />
          <CopyField label="OS build" value={d.osBuild} />
        </dl>
      </section>

      {d.jobs.length > 0 && (
        <section className="rounded-xl border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-medium text-ink-2">Recent fixes</h2>
          <ul className="divide-y divide-line text-sm">
            {d.jobs.slice(0, 5).map((j) => (
              <li key={j.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                <span>
                  <span className="font-mono text-xs">{j.scriptId}</span>
                  {j.ruleId && <span className="text-ink-3"> for {j.ruleId}</span>}
                  <span className="text-ink-3"> · {j.createdBy} · {timeAgo(j.createdAt)}</span>
                </span>
                <span className={`font-medium ${JOB_TONE[j.status]}`}>{j.status.replace('_', ' ')}</span>
                {j.status === 'failed' && j.stderr && <span className="w-full font-mono text-xs text-critical-ink">{j.stderr.slice(0, 300)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Checklist</h2>
        <label className="inline-flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} className="accent-accent" />
          Issues only
        </label>
      </div>

      {STAGES.map((stage: Stage) => {
        const rules = d.rules.filter((r) => r.stage === stage).filter((r) => {
          if (!issuesOnly) return true;
          const st = rowState(byRule.get(r.id), attByRule.has(r.id));
          return st !== 'pass' && st !== 'attested' && st !== 'skip';
        });
        const items = d.manualItems.filter((i) => i.stage === stage).filter((i) => !issuesOnly || !attByItem.has(i.id));
        if (issuesOnly && rules.length === 0 && items.length === 0) return null;
        return (
          <section key={stage} id={`stage-${stage}`} className="overflow-hidden rounded-xl border border-line bg-surface">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="font-semibold">{STAGE_LABEL[stage]}</h3>
              <Badge tone={STAGE_STATE[d.stages[stage]]} />
            </header>
            {rules.length > 0 && (
              <ul className="divide-y divide-line">
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    result={byRule.get(rule.id)}
                    attestation={attByRule.get(rule.id)}
                    busy={actions.busy}
                    onAttest={() => actions.attestRule(rule.id)}
                    onRevoke={() => actions.revoke(attByRule.get(rule.id)!.id)}
                    onFix={() => actions.fix(rule)}
                  />
                ))}
              </ul>
            )}
            {items.length > 0 && (
              <div className="border-t border-line bg-page/40 px-4 py-3">
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Manual steps</h4>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {items.map((item) => {
                    const a = attByItem.get(item.id);
                    const checked = optimistic[item.id] ?? Boolean(a);
                    return (
                      <li key={item.id}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm">
                          <input type="checkbox" checked={checked} onChange={() => actions.toggleItem(item.id, a)} className="mt-0.5 accent-accent" />
                          <span>
                            <span className={a ? 'text-ink-2' : ''}>{item.label}</span>
                            {a && (
                              <span className="block text-xs text-ink-3">
                                {a.by} · {timeAgo(a.at)}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function DeviceDetailPage({ id, onBack }: { id: string; onBack: () => void }) {
  const source = useSource();
  const { data, error, loading, reload } = usePoll(() => source.getDevice(id), 5000, [source, id]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // manual-step ticks show instantly; rolled back if the server refuses
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  const flash = (msg: string, ms = 3500) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), ms);
  };

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) flash(done);
      await reload();
    } catch (e) {
      flash(`Failed: ${(e as Error).message}`, 6000);
    } finally {
      setBusy(false);
    }
  };

  const watchJob = async (job: JobView) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const j = await source.getJob(job.id).catch(() => null);
      if (!j) return;
      if (j.status === 'succeeded' || j.status === 'failed' || j.status === 'timed_out') {
        flash(j.status === 'succeeded' ? `Fix ${j.scriptId} succeeded — re-checking.` : `Fix ${j.scriptId} ${j.status.replace('_', ' ')}: ${(j.stderr ?? '').slice(0, 160)}`, 7000);
        await reload();
        return;
      }
    }
  };

  const actions: DeviceActions = {
    busy,
    attestRule: (ruleId) => {
      const note = window.prompt('Note (optional) — why is this OK?') ?? undefined;
      void act(() => source.attest(id, { ruleId, ...(note ? { note } : {}) }));
    },
    toggleItem: (itemId, existing) => {
      setOptimistic((o) => ({ ...o, [itemId]: !existing }));
      void (async () => {
        try {
          await (existing ? source.revokeAttestation(id, existing.id) : source.attest(id, { itemId }));
          await reload();
        } catch (e) {
          flash(`Failed: ${(e as Error).message}`, 6000);
        } finally {
          setOptimistic(({ [itemId]: _done, ...rest }) => rest);
        }
      })();
    },
    revoke: (attId) => void act(() => source.revokeAttestation(id, attId)),
    fix: (rule) =>
      void act(async () => {
        const job = await source.createJob(id, rule.remediation!.scriptId, rule.remediation!.params, rule.id);
        flash(`Queued ${job.scriptId}. The laptop picks it up within 15 s.`);
        void watchJob(job);
      }),
    runAll: () => void act(() => source.runNow(id), 'Queued: run all checks. Results in about a minute.'),
  };

  if (!data && loading) return <p className="text-sm text-ink-3">Loading device…</p>;
  if (!data) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="text-sm text-accent">
          ← Fleet
        </button>
        {error ? <Banner>Can't load this device: {error.message}</Banner> : <p>Device not found.</p>}
      </div>
    );
  }
  return (
    <>
      {error && <Banner>Connection problem: {error.message}. Showing last known data.</Banner>}
      <DeviceView d={data} actions={actions} onBack={onBack} optimistic={optimistic} />
      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm text-page shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
