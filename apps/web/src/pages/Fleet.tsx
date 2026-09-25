import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { STAGES } from '@umd/contracts';
import { RULES, STAGE_LABEL, listDevices, timeAgo, viewDevice, type DeviceView } from '../data.js';
import { Badge, READINESS, type DisplayReadiness } from '../components/status.js';
import { StageBar, StageLegend } from '../components/StageBar.js';

const ORDER: DisplayReadiness[] = ['not-ready', 'degraded', 'in-progress', 'stale', 'ready'];
const RULE_NAME = new Map(RULES.map((r) => [r.id, r.name]));

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

function FailingSummary({ v }: { v: DeviceView }) {
  if (v.failing.length === 0) {
    const waiting = STAGES.filter((s) => v.stages[s] === 'pending').map((s) => STAGE_LABEL[s]);
    return <span className="text-sm text-ink-3">{waiting.length ? `Waiting on ${waiting.join(', ')}` : '—'}</span>;
  }
  const first = v.failing.slice(0, 2).map((f) => RULE_NAME.get(f.ruleId) ?? f.ruleId);
  const more = v.failing.length - first.length;
  return (
    <span className="text-sm text-ink-2">
      {first.join(', ')}
      {more > 0 && <span className="text-ink-3"> +{more} more</span>}
    </span>
  );
}

export function Fleet({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DisplayReadiness | null>(null);
  const views = useMemo(() => listDevices().map((d) => viewDevice(d)), []);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<DisplayReadiness, number>;
    views.forEach((v) => c[v.display]++);
    return c;
  }, [views]);

  const q = query.trim().toLowerCase();
  const rows = views
    .filter((v) => !filter || v.display === filter)
    .filter((v) => !q || [v.device.assetTag, v.device.serial, v.device.hostname].some((f) => f.toLowerCase().includes(q)))
    .sort((a, b) => ORDER.indexOf(a.display) - ORDER.indexOf(b.display) || a.device.assetTag.localeCompare(b.device.assetTag));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Fleet</h1>
          <p className="text-sm text-ink-2">
            {views.length} UMDs · {counts.ready} ready for the line
          </p>
        </div>
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

        <ul className="divide-y divide-line sm:hidden">
          {rows.map((v) => (
            <li key={v.device.id}>
              <button type="button" onClick={() => onOpen(v.device.id)} className="w-full space-y-2 px-4 py-3 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium">{v.device.assetTag}</span>
                  <Badge tone={READINESS[v.display]} />
                </div>
                <div className="flex items-center gap-3">
                  <StageBar stages={v.stages} criticalStage={v.criticalStage} />
                  <span className="tabular text-xs text-ink-2">{v.completeCount}/5</span>
                </div>
                <div className="flex justify-between gap-3">
                  <FailingSummary v={v} />
                  <span className="tabular shrink-0 text-xs text-ink-3">{timeAgo(v.device.lastSeenAt)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto sm:block">
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
                <tr
                  key={v.device.id}
                  onClick={() => onOpen(v.device.id)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-raised"
                >
                  <td className="px-4 py-3">
                    <div className="font-mono text-sm font-medium">{v.device.assetTag}</div>
                    <div className="text-xs text-ink-3">{v.device.model}</div>
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
                    <FailingSummary v={v} />
                  </td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-sm text-ink-2">{timeAgo(v.device.lastSeenAt)}</td>
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
        </div>
      </section>
    </div>
  );
}
