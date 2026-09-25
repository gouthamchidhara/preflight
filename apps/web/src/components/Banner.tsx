import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

export function Banner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/60 bg-warning/10 px-3 py-2 text-sm text-ink">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning-ink" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
