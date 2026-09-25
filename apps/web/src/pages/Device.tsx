import { useMemo, useState } from 'react';
import { STAGES, type Attestation, type Result, type Rule, type Stage } from '@umd/contracts';
import { ArrowLeft, Check, Copy, Plug, RefreshCw, Network, Signal, Wrench } from 'lucide-react';
import { MANUAL_ITEMS, RULES, STAGE_LABEL, getDevice, timeAgo, viewDevice } from '../data.js';
import { Badge, READINESS, RESULT, STAGE_STATE } from '../components/status.js';
import { StageBar } from '../components/StageBar.js';

const CURRENT_USER = 'you';

function show(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="flex items-center gap-1.5">
        <span className="truncate font-mono text-sm">{value}</span>
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

function Chip({ ok, icon: Icon, label }: { ok: boolean; icon: typeof Plug; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        ok ? 'border-line text-ink-2' : 'border-line text-ink-3 line-through'
      }`}
    >
      <Icon size={13} aria-hidden />
      {label}
      <span className="sr-only">{ok ? 'up' : 'down'}</span>
    </span>
  );
}

type RowState = keyof typeof RESULT;

function rowState(result: Result | undefined, attested: boolean): RowState {
  if (attested) return 'attested';
  if (!result) return 'pending';
  if (result.status === 'skip' && result.skipReason === 'precondition') return 'pending';
  return result.status;
}

function RuleRow({
  rule,
  result,
  attestation,
  onAttest,
  onFix,
}: {
  rule: Rule;
  result: Result | undefined;
  attestation: Attestation | undefined;
  onAttest: () => void;
  onFix: () => void;
}) {
  const state = rowState(result, Boolean(attestation));
  const failing = state === 'fail' || state === 'error';
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
        {(failing || state === 'needs_human' || state === 'pending' || state === 'skip') && (
          <dl className="mt-1 grid gap-x-3 text-sm sm:grid-cols-[5rem_1fr]">
            <dt className="text-ink-3">Expected</dt>
            <dd className="break-words font-mono text-xs leading-5 text-ink-2">{show(result?.expected)}</dd>
            <dt className="text-ink-3">Actual</dt>
            <dd className={`break-words font-mono text-xs leading-5 ${failing ? 'text-critical-ink' : 'text-ink-2'}`}>
              {show(result?.actual)}
            </dd>
          </dl>
        )}
        {failing && rule.hint && <p className="mt-1.5 text-sm text-ink-2">→ {rule.hint}</p>}
        {attestation && (
          <p className="mt-1 text-xs text-ink-3">
            Attested by {attestation.by} · {timeAgo(attestation.at)}
          </p>
        )}
      </div>
      <div className="flex items-start gap-2 sm:justify-end">
        {failing && rule.remediation && (
          <button
            type="button"
            onClick={onFix}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            <Wrench size={14} aria-hidden /> Run fix
          </button>
        )}
        {(state === 'needs_human' || failing) && !attestation && (
          <button
            type="button"
            onClick={onAttest}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:border-ink-3 hover:text-ink"
          >
            {failing ? 'Accept' : 'Attest'}
          </button>
        )}
      </div>
    </li>
  );
}

export function DeviceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const device = getDevice(id);
  const [attestations, setAttestations] = useState<Attestation[]>(device?.attestations ?? []);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const view = useMemo(() => (device ? viewDevice(device, attestations) : null), [device, attestations]);

  if (!device || !view) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="text-sm text-accent">
          ← Fleet
        </button>
        <p>Device not found.</p>
      </div>
    );
  }

  const byRule = new Map(device.results.map((r) => [r.ruleId, r]));
  const attByRule = new Map(attestations.filter((a) => a.ruleId).map((a) => [a.ruleId!, a]));
  const attByItem = new Map(attestations.filter((a) => a.itemId).map((a) => [a.itemId!, a]));
  const now = () => new Date().toISOString();
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };
  const attestRule = (ruleId: string) => setAttestations((a) => [...a, { ruleId, by: CURRENT_USER, at: now() }]);
  const toggleItem = (itemId: string) =>
    setAttestations((a) =>
      a.some((x) => x.itemId === itemId) ? a.filter((x) => x.itemId !== itemId) : [...a, { itemId, by: CURRENT_USER, at: now() }],
    );

  const lastRun = device.results.reduce((m, r) => (r.checkedAt > m ? r.checkedAt : m), '');

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft size={16} aria-hidden /> Fleet
      </button>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{device.assetTag}</h1>
            <Badge tone={READINESS[view.display]} size="base" />
          </div>
          <p className="mt-1 text-sm text-ink-2">
            {device.hostname} · {device.model} · last check-in {timeAgo(device.lastSeenAt)} · last run {timeAgo(lastRun)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip ok={device.telemetry.onAC} icon={Plug} label="On AC" />
            <Chip ok={device.telemetry.lanUp} icon={Network} label="LAN" />
            <Chip ok={device.telemetry.wwanReady} icon={Signal} label="Cellular" />
          </div>
        </div>
        <button
          type="button"
          onClick={() => flash('Queued: run all checks. Agent picks it up within 15 s.')}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          <RefreshCw size={16} aria-hidden /> Run all checks
        </button>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-sm font-medium text-ink-2">Lifecycle</h2>
          <StageBar stages={view.stages} criticalStage={view.criticalStage} />
          <div className="mt-2 grid grid-cols-5 gap-0.5">
            {STAGES.map((s) => (
              <a key={s} href={`#stage-${s}`} className="min-w-0 hover:underline">
                <span className="block truncate text-sm text-ink">{STAGE_LABEL[s]}</span>
                <Badge tone={STAGE_STATE[view.stages[s]]} size="xs" />
              </a>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4">
          <CopyField label="Asset tag (EID)" value={device.assetTag} />
          <CopyField label="Serial" value={device.serial} />
          <CopyField label="BIOS" value={device.biosVersion} />
          <CopyField label="OS build" value={device.osBuild} />
        </dl>
      </section>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Checklist</h2>
        <label className="inline-flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} className="accent-accent" />
          Issues only
        </label>
      </div>

      {STAGES.map((stage: Stage) => {
        const rules = RULES.filter((r) => r.stage === stage).filter((r) => {
          if (!issuesOnly) return true;
          const st = rowState(byRule.get(r.id), attByRule.has(r.id));
          return st !== 'pass' && st !== 'attested' && st !== 'skip';
        });
        const items = MANUAL_ITEMS.filter((i) => i.stage === stage).filter((i) => !issuesOnly || !attByItem.has(i.id));
        if (issuesOnly && rules.length === 0 && items.length === 0) return null;
        return (
          <section key={stage} id={`stage-${stage}`} className="overflow-hidden rounded-xl border border-line bg-surface">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="font-semibold">{STAGE_LABEL[stage]}</h3>
              <Badge tone={STAGE_STATE[view.stages[stage]]} />
            </header>
            {rules.length > 0 && (
              <ul className="divide-y divide-line">
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    result={byRule.get(rule.id)}
                    attestation={attByRule.get(rule.id)}
                    onAttest={() => attestRule(rule.id)}
                    onFix={() => flash(`Queued fix ${rule.remediation!.scriptId} → re-check ${rule.id} after.`)}
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
                    return (
                      <li key={item.id}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm">
                          <input type="checkbox" checked={Boolean(a)} onChange={() => toggleItem(item.id)} className="mt-0.5 accent-accent" />
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

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm text-page shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
