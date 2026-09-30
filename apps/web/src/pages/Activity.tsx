/**
 * Fleet-wide job feed: what fixes were run, by whom, and how they ended.
 * Detail fetches are capped (MAX_DEVICES) because the API has no fleet-wide job endpoint.
 */
import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import type { DeviceDetail, JobView } from '@umd/contracts';
import { timeAgo } from '../lib/format.js';
import { usePoll } from '../lib/usePoll.js';
import { useSource } from '../lib/context.js';
import { Banner } from '../components/Banner.js';
import { Tabs } from '../components/Tabs.js';

const MAX_DEVICES = 25;

const JOB_TONE: Record<JobView['status'], string> = {
  queued: 'text-ink-2',
  dispatched: 'text-accent',
  running: 'text-accent',
  succeeded: 'text-good-ink',
  failed: 'text-critical-ink',
  timed_out: 'text-critical-ink',
};

type Filter = 'all' | 'open' | 'failed';
const OPEN: JobView['status'][] = ['queued', 'dispatched', 'running'];

interface Row extends JobView {
  deviceId: string;
  deviceLabel: string;
}

export function Activity({ onOpen }: { onOpen: (id: string) => void }) {
  const source = useSource();
  const [filter, setFilter] = useState<Filter>('all');

  const { data, error, loading } = usePoll(
    async () => {
      const devices = await source.listDevices();
      const details = await Promise.all(devices.slice(0, MAX_DEVICES).map((d) => source.getDevice(d.id)));
      return details.filter((d): d is DeviceDetail => Boolean(d));
    },
    20_000,
    [source],
  );

  const rows = useMemo<Row[]>(
    () =>
      (data ?? [])
        .flatMap((d) => d.jobs.map((j) => ({ ...j, deviceId: d.id, deviceLabel: d.assetTag || d.hostname })))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data],
  );

  const shown = rows.filter((j) => (filter === 'open' ? OPEN.includes(j.status) : filter === 'failed' ? j.status === 'failed' || j.status === 'timed_out' : true));

  if (!data && loading) return <p className="text-sm text-ink-3">Loading activity…</p>;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-ink-2">Fix jobs dispatched to laptops, newest first.</p>
      </header>

      {error && <Banner>Can't reach the Preflight server: {error.message}. Showing last known data.</Banner>}

      <Tabs
        label="Job filter"
        active={filter}
        onSelect={setFilter}
        tabs={[
          { key: 'all' as Filter, label: 'All jobs', count: rows.length },
          { key: 'open' as Filter, label: 'In flight', count: rows.filter((j) => OPEN.includes(j.status)).length },
          { key: 'failed' as Filter, label: 'Failed', count: rows.filter((j) => j.status === 'failed' || j.status === 'timed_out').length },
        ]}
      />

      {shown.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface px-4 py-12 text-center">
          <History size={26} className="mx-auto text-ink-3" aria-hidden />
          <p className="mt-2 font-medium">No jobs yet.</p>
          <p className="text-sm text-ink-2">Run a fix from the Fix center or a device page.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {shown.map((j) => (
            <li key={j.id} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0">
                  <button type="button" onClick={() => onOpen(j.deviceId)} className="font-mono text-sm font-medium hover:underline">
                    {j.deviceLabel}
                  </button>
                  <span className="text-ink-3"> · </span>
                  <span className="font-mono text-xs">{j.scriptId}</span>
                  {j.ruleId && <span className="text-ink-3"> for {j.ruleId}</span>}
                </span>
                <span className={`text-sm font-medium ${JOB_TONE[j.status]}`}>{j.status.replace('_', ' ')}</span>
              </div>
              <p className="text-xs text-ink-3">
                {j.createdBy} · {timeAgo(j.createdAt)}
              </p>
              {(j.stdout || j.stderr) && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-ink-3">Show output</summary>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-page p-2 font-mono text-ink-2">
                    {j.stdout}
                    {j.stderr ? `\n${j.stderr}` : ''}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
