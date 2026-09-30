/**
 * Fleet-wide remediation. Groups every failing / needs-human check by rule so a tech can
 * run the whitelisted fix on all affected laptops at once instead of opening them one by one.
 * Detail fetches are capped (MAX_DEVICES) because the API has no fleet-wide results endpoint.
 */
import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, Hand, RefreshCw, ShieldAlert, Wrench } from 'lucide-react';
import type { DeviceDetail, DeviceSummary, Result, Rule, Stage } from '@umd/contracts';
import { STAGE_LABEL, show, timeAgo } from '../lib/format.js';
import { openChecks, type RowState } from '../lib/ruleState.js';
import { usePoll } from '../lib/usePoll.js';
import { useSource } from '../lib/context.js';
import { Badge, RESULT } from '../components/status.js';
import { Banner } from '../components/Banner.js';
import { Tabs } from '../components/Tabs.js';
import { Toast } from '../components/Toast.js';

const MAX_DEVICES = 25;

type Mode = 'failing' | 'needs_human';

interface Target {
  device: DeviceSummary;
  result: Result | undefined;
  state: RowState;
}
interface Group {
  rule: Rule;
  targets: Target[];
}

function groupByRule(details: DeviceDetail[], mode: Mode): Group[] {
  const groups = new Map<string, Group>();
  for (const d of details) {
    for (const { rule, result, state } of openChecks(d)) {
      const wanted = mode === 'failing' ? state === 'fail' || state === 'error' : state === 'needs_human';
      if (!wanted) continue;
      const g = groups.get(rule.id) ?? { rule, targets: [] };
      g.targets.push({ device: d, result, state });
      groups.set(rule.id, g);
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.rule.severity === 'critical') - Number(a.rule.severity === 'critical') ||
      b.targets.length - a.targets.length ||
      a.rule.name.localeCompare(b.rule.name),
  );
}

function GroupCard({ group, busy, onFix, onFixAll, onRecheck, onOpen }: {
  group: Group;
  busy: boolean;
  onFix: (deviceId: string, rule: Rule) => void;
  onFixAll: (group: Group) => void;
  onRecheck: (deviceId: string, ruleId: string) => void;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(group.targets.length <= 3);
  const { rule } = group;
  const critical = rule.severity === 'critical';
  const fixable = Boolean(rule.remediation);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-start gap-3 px-4 py-3">
        <span className={`mt-0.5 rounded-lg p-2 ${critical ? 'bg-critical/10 text-critical-ink' : 'bg-warning/10 text-warning-ink'}`}>
          <ShieldAlert size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="font-medium">{rule.name}</h3>
            <span className="font-mono text-xs text-ink-3">{rule.id}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            {STAGE_LABEL[rule.stage as Stage]} · {critical ? 'critical' : 'warn'} · {group.targets.length} device{group.targets.length === 1 ? '' : 's'}
            {fixable ? ' · fix available' : ' · manual'}
          </p>
          {rule.hint && <p className="mt-1.5 text-sm text-ink-2">→ {rule.hint}</p>}
        </div>
        <div className="flex items-center gap-2">
          {fixable && (
            <button
              type="button"
              onClick={() => onFixAll(group)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
            >
              <Wrench size={14} aria-hidden /> Fix all {group.targets.length}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink-2 hover:text-ink"
          >
            Devices <ChevronDown size={14} className={open ? 'rotate-180' : ''} aria-hidden />
          </button>
        </div>
      </header>

      {open && (
        <ul className="divide-y divide-line border-t border-line">
          {group.targets.map(({ device, result, state }) => (
            <li key={device.id} className="grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[13rem_1fr_auto]">
              <button type="button" onClick={() => onOpen(device.id)} className="text-left">
                <span className="block font-mono text-sm font-medium hover:underline">{device.assetTag || device.hostname}</span>
                <span className="block text-xs text-ink-3">{device.model} · {timeAgo(device.lastSeenAt)}</span>
              </button>
              <dl className="min-w-0 grid gap-x-3 text-sm sm:grid-cols-[4.5rem_1fr]">
                <dt className="text-ink-3">Expected</dt>
                <dd className="break-words font-mono text-xs leading-5 text-ink-2">{show(result?.expected)}</dd>
                <dt className="text-ink-3">Actual</dt>
                <dd className="break-words font-mono text-xs leading-5 text-critical-ink">{show(result?.actual)}</dd>
              </dl>
              <div className="flex items-start gap-2 sm:justify-end">
                <Badge tone={RESULT[state]} />
                <button
                  type="button"
                  onClick={() => onRecheck(device.id, rule.id)}
                  disabled={busy}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-ink-3 hover:text-ink disabled:opacity-50"
                >
                  Re-check
                </button>
                {rule.remediation && (
                  <button
                    type="button"
                    onClick={() => onFix(device.id, rule)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    <Wrench size={13} aria-hidden /> Run fix
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FixCenter({ onOpen }: { onOpen: (id: string) => void }) {
  const source = useSource();
  const [mode, setMode] = useState<Mode>('failing');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data, error, loading, reload } = usePoll(
    async () => {
      const devices = await source.listDevices();
      const need = devices.filter((d) => d.failing.length > 0 || d.readiness === 'in-progress').slice(0, MAX_DEVICES);
      const details = await Promise.all(need.map((d) => source.getDevice(d.id)));
      return { devices, details: details.filter((d): d is DeviceDetail => Boolean(d)) };
    },
    20_000,
    [source],
  );

  const failing = useMemo(() => groupByRule(data?.details ?? [], 'failing'), [data]);
  const human = useMemo(() => groupByRule(data?.details ?? [], 'needs_human'), [data]);
  const groups = mode === 'failing' ? failing : human;

  const flash = (msg: string, ms = 4000) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), ms);
  };

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      flash(done);
      await reload();
    } catch (e) {
      flash(`Failed: ${(e as Error).message}`, 6000);
    } finally {
      setBusy(false);
    }
  };

  const fix = (deviceId: string, rule: Rule) =>
    void act(() => source.createJob(deviceId, rule.remediation!.scriptId, rule.remediation!.params, rule.id), 'Fix queued. The laptop picks it up within 15 s.');

  const fixAll = (group: Group) =>
    void act(
      () => Promise.all(group.targets.map((t) => source.createJob(t.device.id, group.rule.remediation!.scriptId, group.rule.remediation!.params, group.rule.id))),
      `Queued ${group.targets.length} fix job${group.targets.length === 1 ? '' : 's'}.`,
    );

  const recheck = (deviceId: string, ruleId: string) => void act(() => source.runNow(deviceId, undefined, [ruleId]), 'Re-check queued.');

  if (!data && loading) return <p className="text-sm text-ink-3">Loading open checks…</p>;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fix center</h1>
          <p className="text-sm text-ink-2">Every check that did not pass, grouped so one fix can cover the whole fleet.</p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:border-ink-3 hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={15} aria-hidden /> Refresh
        </button>
      </header>

      {error && <Banner>Can't reach the Preflight server: {error.message}. Showing last known data.</Banner>}
      {(data?.devices.length ?? 0) > MAX_DEVICES && (
        <Banner>Showing the first {MAX_DEVICES} laptops that need attention. Open a device from Fleet for the rest.</Banner>
      )}

      <Tabs
        label="Open check type"
        active={mode}
        onSelect={setMode}
        tabs={[
          { key: 'failing', label: 'Failing checks', icon: ShieldAlert, count: failing.reduce((n, g) => n + g.targets.length, 0) },
          { key: 'needs_human', label: 'Needs a human', icon: Hand, count: human.reduce((n, g) => n + g.targets.length, 0) },
        ]}
      />

      {groups.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface px-4 py-12 text-center">
          <CheckCircle2 size={28} className="mx-auto text-good-ink" aria-hidden />
          <p className="mt-2 font-medium">{mode === 'failing' ? 'No failing checks.' : 'Nothing waiting on a human.'}</p>
          <p className="text-sm text-ink-2">The fleet is clear for this view.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupCard key={g.rule.id} group={g} busy={busy} onFix={fix} onFixAll={fixAll} onRecheck={recheck} onOpen={onOpen} />
          ))}
        </div>
      )}

      {toast && <Toast>{toast}</Toast>}
    </div>
  );
}
