import { useEffect, useRef, useState } from 'react';

export function NoteDialog({ title, onSubmit, onCancel }: { title: string; onSubmit: (note?: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="presentation" onMouseDown={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-dialog-title"
        className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl"
        onSubmit={(e) => { e.preventDefault(); onSubmit(note.trim() || undefined); }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="note-dialog-title" className="text-lg font-semibold">{title}</h2>
        <label className="mt-4 block text-sm text-ink-2" htmlFor="attestation-note">Note (optional)</label>
        <textarea id="attestation-note" ref={input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-accent" />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:text-ink">Cancel</button>
          <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90">Save attestation</button>
        </div>
      </form>
    </div>
  );
}
