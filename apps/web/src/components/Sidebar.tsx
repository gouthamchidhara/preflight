import { LogOut, PlaneTakeoff, X } from 'lucide-react';
import { NAV, type Page } from '../lib/nav.js';
import { signOut } from '../lib/auth.js';
import type { Me } from '../lib/source.js';

interface Props {
  page: Page;
  me: Me | null;
  sourceKind: 'api' | 'mock';
  counts: { devices: number; issues: number };
  open: boolean;
  onClose: () => void;
}

function Count({ value, tone }: { value: number; tone: 'critical' | 'muted' }) {
  if (!value) return null;
  return (
    <span
      className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold tabular ${
        tone === 'critical' ? 'bg-critical/15 text-critical-ink' : 'bg-track text-ink-2'
      }`}
    >
      {value}
    </span>
  );
}

export function Sidebar({ page, me, sourceKind, counts, open, onClose }: Props) {
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" role="presentation" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-surface transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <PlaneTakeoff size={20} className="shrink-0 text-accent" aria-hidden />
          <span className="font-semibold">Preflight</span>
          <span className="text-xs text-ink-3">UMD readiness</span>
          <button type="button" onClick={onClose} aria-label="Close navigation" className="ml-auto rounded p-1 text-ink-3 hover:text-ink lg:hidden">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-2" aria-label="Sections">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.page === page || (item.page === 'fleet' && page === 'device');
            return (
              <a
                key={item.page}
                href={item.hash}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                title={item.hint}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  active ? 'bg-accent/10 font-medium text-accent' : 'text-ink-2 hover:bg-raised hover:text-ink'
                }`}
              >
                <Icon size={17} strokeWidth={2.1} aria-hidden />
                {item.label}
                {item.page === 'fixes' && <Count value={counts.issues} tone="critical" />}
                {item.page === 'fleet' && <Count value={counts.devices} tone="muted" />}
              </a>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-line px-4 py-3 text-sm">
          {sourceKind === 'mock' && (
            <span className="inline-block rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-3">Mock data</span>
          )}
          {me && (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-ink-2">{me.name}</span>
              {sourceKind === 'api' && (
                <button type="button" onClick={() => void signOut()} aria-label="Sign out" className="rounded p-1 text-ink-3 hover:text-ink">
                  <LogOut size={16} />
                </button>
              )}
            </div>
          )}
          {me && me.roles.length > 0 && <p className="text-xs text-ink-3">{me.roles.join(', ')}</p>}
        </div>
      </aside>
    </>
  );
}
