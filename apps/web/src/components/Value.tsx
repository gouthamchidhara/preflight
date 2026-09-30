import { useState } from 'react';

const LIMIT = 160;

/** Check output can be a multi-KB device dump; show a readable slice until asked for the rest. */
export function Value({ text, bad = false }: { text: string; bad?: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.length > LIMIT;
  return (
    <span className={`block break-all font-mono text-xs leading-5 ${bad ? 'text-critical-ink' : 'text-ink-2'}`}>
      {long && !open ? `${text.slice(0, LIMIT)}…` : text}
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="ml-1 whitespace-nowrap text-accent hover:underline">
          {open ? 'less' : 'more'}
        </button>
      )}
    </span>
  );
}
