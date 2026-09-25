import type { Stage } from '@umd/contracts';

export const STAGE_LABEL: Record<Stage, string> = {
  image: 'Image',
  config: 'Config',
  hardware: 'Hardware',
  bios: 'BIOS',
  register: 'Register',
};

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function show(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}
