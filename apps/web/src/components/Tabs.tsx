import type { LucideIcon } from 'lucide-react';

export interface TabDef<T extends string> {
  key: T;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

export function Tabs<T extends string>({ tabs, active, onSelect, label }: { tabs: TabDef<T>[]; active: T; onSelect: (key: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(t.key)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition ${
              on ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-2 hover:border-line hover:text-ink'
            }`}
          >
            {Icon && <Icon size={15} aria-hidden />}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs tabular ${on ? 'bg-accent/15 text-accent' : 'bg-track text-ink-2'}`}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
