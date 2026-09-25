import { STAGES, type Stage, type StageState } from '@umd/contracts';
import { STAGE_LABEL } from '../lib/format.js';

interface Props {
  stages: Record<Stage, StageState>;
  criticalStage: Record<Stage, boolean>;
}

function fill(state: StageState, critical: boolean): string {
  if (state === 'complete') return 'bg-good';
  if (state === 'failing') return critical ? 'bg-critical' : 'bg-warning';
  return 'bg-track';
}

const WORD: Record<StageState, string> = { complete: 'complete', failing: 'failing', pending: 'pending' };

/** Five-segment lifecycle bar (§1 stages). Text label per segment for screen readers + hover. */
export function StageBar({ stages, criticalStage }: Props) {
  return (
    <div className="w-full">
      <div className="flex gap-0.5" role="list" aria-label="Stage progress">
        {STAGES.map((s) => (
          <div
            key={s}
            role="listitem"
            title={`${STAGE_LABEL[s]}: ${WORD[stages[s]]}`}
            aria-label={`${STAGE_LABEL[s]} ${WORD[stages[s]]}`}
            className={`h-2 flex-1 first:rounded-l last:rounded-r ${fill(stages[s], criticalStage[s])}`}
          />
        ))}
      </div>
    </div>
  );
}

export function StageLegend() {
  const items: [string, string][] = [
    ['bg-good', 'Complete'],
    ['bg-critical', 'Critical failing'],
    ['bg-warning', 'Warning failing'],
    ['bg-track', 'Pending'],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2 w-4 rounded-sm ${c}`} aria-hidden />
          {l}
        </span>
      ))}
    </div>
  );
}
