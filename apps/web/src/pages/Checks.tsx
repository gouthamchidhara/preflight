/**
 * Validation catalog: every rule the agent can run, what it proves, and how the fleet is doing on it.
 */
import { useMemo, useState } from 'react';
import { Search, Wrench } from 'lucide-react';
import { STAGES, type DeviceSummary, type Rule, type Stage } from '@umd/contracts';
import { STAGE_LABEL } from '../lib/format.js';
import { usePoll } from '../lib/usePoll.js';
import { useSource } from '../lib/context.js';
import { Tabs } from '../components/Tabs.js';

type StageFilter = Stage | 'all';

function failingCounts(devices: DeviceSummary[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of devices) for (const f of d.failing) m.set(f.ruleId, (m.get(f.ruleId) ?? 0) + 1);
  return m;
}

export function ChecksView({ rules, devices }: { rules: Rule[]; devices: DeviceSummary[] }) {
  const [stage, setStage] = useState<StageFilter>('all');
  const [query, setQuery] = useState('');
  const [fixableOnly, setFixableOnly] = useState(false);
  const counts = useMemo(() => failingCounts(devices), [devices]);

  const q = query.trim().toLowerCase();
  const rows = rules
    .filter((r) => stage === 'all' || r.stage === stage)
    .filter((r) => !fixableOnly || r.remediation)
    .filter((r) => !q || [r.id, r.name, r.type].some((f) => f.toLowerCase().includes(q)));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Test cases</h1>
        <p className="text-sm text-ink-2">
          {rules.length} validation checks · {rules.filter((r) => r.remediation).length} have an automated fix
        </p>
      </header>

      <Tabs
        label="Stage"
        active={stage}
        onSelect={setStage}
        tabs={[
          { key: 'all' as StageFilter, label: 'All stages', count: rules.length },
          ...STAGES.map((s) => ({ key: s as StageFilter, label: STAGE_LABEL[s], count: rules.filter((r) => r.stage === s).length })),
        ]}
      />

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-raised px-3 py-1.5 sm:max-w-xs">
            <Search size={16} className="shrink-0 text-ink-3" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rule id, name, check type"
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-3"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={fixableOnly} onChange={(e) => setFixableOnly(e.target.checked)} className="accent-accent" />
            Fixable only
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="text-xs uppercase tracking-wide text-ink-3">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-medium">Check</th>
                <th className="px-4 py-2.5 font-medium">Stage</th>
                <th className="px-4 py-2.5 font-medium">Severity</th>
                <th className="px-4 py-2.5 font-medium">Fix</th>
                <th className="px-4 py-2.5 font-medium">Failing now</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const failing = counts.get(r.id) ?? 0;
                return (
                  <tr key={r.id} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name}</div>
                      <div className="font-mono text-xs text-ink-3">{r.id} · {r.type}</div>
                      {r.hint && <p className="mt-1 max-w-xl text-sm text-ink-2">{r.hint}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-2">{STAGE_LABEL[r.stage]}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={r.severity === 'critical' ? 'text-critical-ink' : 'text-ink-2'}>{r.severity}</span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {r.remediation ? (
                        <span className="inline-flex items-center gap-1.5 text-ink-2">
                          <Wrench size={13} className="text-accent" aria-hidden />
                          <span className="font-mono text-xs">{r.remediation.scriptId}</span>
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`tabular text-sm ${failing ? 'font-medium text-critical-ink' : 'text-ink-3'}`}>{failing || '—'}</span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-ink-3">
                    No checks match.
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

export function Checks({ rules }: { rules: Rule[] }) {
  const source = useSource();
  const { data } = usePoll(() => source.listDevices(), 30_000, [source]);
  return <ChecksView rules={rules} devices={data ?? []} />;
}
