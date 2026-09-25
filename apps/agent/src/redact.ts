/**
 * Evidence hygiene (§8): drop sensitive keys/lines, cap size at 8 KB.
 */
const SENSITIVE = /pass|secret|token|key|pwd/i;
const MAX = 8 * 1024 - 256;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (typeof v === 'string') {
    // key=value / key: value lines whose key looks sensitive
    return v.replace(/^([^\n=:]*(?:pass|secret|token|pwd)[^\n=:]*)\s*[=:].*$/gim, '$1=<redacted>');
  }
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, SENSITIVE.test(k) && !/^(keyHashes|hashes|sha256)$/i.test(k) ? '<redacted>' : scrub(x, depth + 1)]),
    );
  }
  return v;
}

export function cleanEvidence(e: unknown): Record<string, unknown> {
  const obj = e && typeof e === 'object' && !Array.isArray(e) ? (e as Record<string, unknown>) : { value: e };
  const scrubbed = scrub(obj) as Record<string, unknown>;
  const s = JSON.stringify(scrubbed);
  if (s.length <= MAX) return scrubbed;
  return { truncated: true, preview: s.slice(0, MAX - 100) };
}

export function cleanValue(v: unknown): unknown {
  const s = scrub(v);
  const str = JSON.stringify(s) ?? '';
  return str.length > 2000 ? `${str.slice(0, 2000)}…` : s;
}
