import type { DisplayReadiness, ResultStatus, StageState } from '@umd/contracts';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Clock,
  Hand,
  Loader,
  WifiOff,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

export type { DisplayReadiness };

interface Tone {
  label: string;
  icon: LucideIcon;
  /** mark/fill color */
  mark: string;
  /** text color on neutral surface */
  ink: string;
}

export const READINESS: Record<DisplayReadiness, Tone> = {
  ready: { label: 'Ready', icon: CheckCircle2, mark: 'bg-good', ink: 'text-good-ink' },
  'in-progress': { label: 'In progress', icon: Loader, mark: 'bg-progress', ink: 'text-accent' },
  degraded: { label: 'Degraded', icon: AlertTriangle, mark: 'bg-warning', ink: 'text-warning-ink' },
  'not-ready': { label: 'Not ready', icon: AlertOctagon, mark: 'bg-critical', ink: 'text-critical-ink' },
  stale: { label: 'Stale', icon: WifiOff, mark: 'bg-ink-3', ink: 'text-ink-2' },
};

export const RESULT: Record<ResultStatus | 'pending' | 'attested', Tone> = {
  pass: { label: 'Pass', icon: CheckCircle2, mark: 'bg-good', ink: 'text-good-ink' },
  fail: { label: 'Fail', icon: XCircle, mark: 'bg-critical', ink: 'text-critical-ink' },
  error: { label: 'Error', icon: AlertOctagon, mark: 'bg-critical', ink: 'text-critical-ink' },
  skip: { label: 'Skipped', icon: CircleSlash, mark: 'bg-ink-3', ink: 'text-ink-3' },
  pending: { label: 'Waiting', icon: Clock, mark: 'bg-ink-3', ink: 'text-ink-2' },
  needs_human: { label: 'Needs human', icon: Hand, mark: 'bg-progress', ink: 'text-accent' },
  attested: { label: 'Attested', icon: CheckCircle2, mark: 'bg-good', ink: 'text-good-ink' },
};

export const STAGE_STATE: Record<StageState, Tone> = {
  complete: { label: 'Complete', icon: CheckCircle2, mark: 'bg-good', ink: 'text-good-ink' },
  failing: { label: 'Failing', icon: XCircle, mark: 'bg-critical', ink: 'text-critical-ink' },
  pending: { label: 'Pending', icon: CircleDashed, mark: 'bg-track', ink: 'text-ink-3' },
};

const SIZE = { xs: ['text-xs', 13], sm: ['text-sm', 16], base: ['text-base', 18] } as const;

export function Badge({ tone, size = 'sm' }: { tone: Tone; size?: keyof typeof SIZE }) {
  const Icon = tone.icon;
  const [text, px] = SIZE[size];
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap ${text} ${tone.ink}`}>
      <Icon size={px} strokeWidth={2.25} aria-hidden />
      {tone.label}
    </span>
  );
}
