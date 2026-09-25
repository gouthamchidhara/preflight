import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { STAGES, type DeviceSummary, type DisplayReadiness, type Rule } from '@umd/contracts';
import { STAGE_LABEL, timeAgo } from '../lib/format.js';
import { usePoll } from '../lib/usePoll.js';
import { useSource } from '../lib/context.js';
import { Badge, READINESS } from '../components/status.js';
import { StageBar, StageLegend } from '../components/StageBar.js';
import { Banner } from '../components/Banner.js';

const ORDER: DisplayReadiness[] = ['not-ready', 'degraded', 'in-progress', 'stale', 'ready'];

function StatTile({ state, count, active, onClick }: { state: DisplayReadiness; count: number; active: boolean; onClick: () => void }) {
  const tone = READINESS[state];
  const Icon = tone.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col gap-1 rounded-xl border bg-raised px-4 py-3 text-left transition hover:border-ink-3 ${
        active ? 'border-accent ring-2 ring-accent/30' : 'border-line'
      }`}
    >
      <span className={`inline-flex items-center gap-1.5 text-sm ${tone.ink}`}>
        <Icon size={16} strokeWidth={2.25} aria-hidden />
        {tone.label}
      </span>
      <span className="text-3xl font-semibold text-ink">{count}</span>
    </button>
  );
}

function IssueSummary({ v, ruleName }: { v: DeviceSummary; ruleName: (id: string) => string }) {
  if (v.failing.length === 0) {
    const waiting = STAGES.filter((s) => v.stages[s] === 'pending').map((s) => STAGE_LABEL[s]);
    return <span className="text-sm text-ink-3">{waiting.length ? `Waiting on ${waiting.join(', ')}` : '—'}</span>;
  }
  const first = v.failing.slice(0, 2).map((f) => ruleName(f.ruleId));
  const more = v.failing.length - first.length;
  return (
    <span className="text-sm text-ink-2">
      {first.join(', ')}
      {more > 0 && <span className="text-ink-3"> +{more} more</span>}
    </span>
  );
}

export function FleetView({ devices, rules, onOpen }: { devices: DeviceSummary[]; rules: Rule[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DisplayReadiness | null>(null);
  const names = useMemo(() => new Map(rules.map((r) => [r.id, r.name])), [rules]);
  const ruleName = (id: string) => names.get(id) ?? id;

  const counts = useMemo(() => {
    const c = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<DisplayReadiness, number>;
    devices.forEach((v) => c[v.display]++);
    return c;
  }, [devices]);

  const q = query.trim().toLowerCase();
  const rows = devices
    .filter((v) => !filter || v.display === filter)
    .filter((v) => !q || [v.assetTag, v.serial, v.hostname].some((f) => f.toLowerCase().includes(q)))
    .sort((a, b) => ORDER.indexOf(a.display) - ORDER.indexOf(b.display) || a.assetTag.localeCompare(b.assetTag));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Fleet</h1>
        <p className="text-sm text-ink-2">
          {devices.length} UMDs · {counts.ready} ready for the line
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Readiness summary">
        {ORDER.map((s) => (
          <StatTile key={s} state={s} count={counts[s]} active={filter === s} onClick={() => setFilter(filter === s ? null : s)} />
        ))}
      </section>

      <section className="rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-raised px-3 py-1.5 sm:max-w-xs">
            <Search size={16} className="shrink-0 text-ink-3" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Asset tag, serial, host"
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-3"
            />
          </label>
          <StageLegend />
        </div>

        {devices.length === 0 && (
          <div className="space-y-2 px-4 py-10 text-center text-sm text-ink-2">
            <p className="font-medium text-ink">No laptops enrolled yet.</p>
            <p>
              On a UMD, as Administrator: <code className="rounded bg-page px-1.5 py-0.5 font-mono text-xs">PreflightAgent.exe enroll --server {typeof window === 'undefined' ? 'https://…' : window.location.origin} --token &lt;token&gt;</code>
            </p>
          </div>
        )}

        <ul className="divide-y divide-line sm:hidden">
          {rows.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => onOpen(v.id)} className="w-full space-y-2 px-4 py-3 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium">{v.assetTag || v.hostname}</span>
                  <Badge tone={READINESS[v.display]} />
                </div>
                <div className="flex items-center gap-3">
                  <StageBar stages={v.stages} criticalStage={v.criticalStage} />
                  <span className="tabular text-xs text-ink-2">{v.completeCount}/5</span>
                </div>
                <div className="flex justify-between gap-3">
                  <IssueSummary v={v} ruleName={ruleName} />
                  <span className="tabular shrink-0 text-xs text-ink-3">{timeAgo(v.lastSeenAt)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto sm:block">
          {devices.length > 0 && (
            <table className="w-full min-w-[760px] text-left">
              <thead className="text-xs uppercase tracking-wide text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-medium">Asset tag</th>
                  <th className="px-4 py-2.5 font-medium">Readiness</th>
                  <th className="w-56 px-4 py-2.5 font-medium">Stages</th>
                  <th className="px-4 py-2.5 font-medium">Open issues</th>
                  <th className="px-4 py-2.5 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} onClick={() => onOpen(v.id)} className="cursor-pointer border-b border-line last:border-0 hover:bg-raised">
                    <td className="px-4 py-3">
                      <div className="font-mono text-sm font-medium">{v.assetTag || v.hostname}</div>
                      <div className="text-xs text-ink-3">{v.model}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={READINESS[v.display]} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <StageBar stages={v.stages} criticalStage={v.criticalStage} />
                        <span className="tabular text-xs text-ink-2">{v.completeCount}/5</span>
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <IssueSummary v={v} ruleName={ruleName} />
                    </td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-sm text-ink-2">{timeAgo(v.lastSeenAt)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-ink-3">
                      No devices match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

export function Fleet({ onOpen, rules }: { onOpen: (id: string) => void; rules: Rule[] }) {
  const source = useSource();
  const { data, error, loading } = usePoll(() => source.listDevices(), 10_000, [source]);
  if (!data && loading) return <p className="text-sm text-ink-3">Loading fleet…</p>;
  return (
    <div className="space-y-4">
      {error && <Banner>Can't reach the Preflight server: {error.message}. Showing last known data.</Banner>}
      <FleetView devices={data ?? []} rules={rules} onOpen={onOpen} />
    </div>
  );
}
