import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_RULES, MANUAL_ITEMS, SCRIPT_CATALOG, isTbd, resolvePolicy, validateScriptParams } from './index.js';

const golden = JSON.parse(readFileSync(new URL('../../../golden/manifest.json', import.meta.url), 'utf8'));

describe('catalog', () => {
  it('ids are unique across rules and manual items', () => {
    const ids = [...DEFAULT_RULES.map((r) => r.id), ...MANUAL_ITEMS.map((i) => i.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every remediation points at a whitelisted script with valid params', () => {
    for (const r of DEFAULT_RULES) {
      if (!r.remediation) continue;
      expect(SCRIPT_CATALOG).toHaveProperty(r.remediation.scriptId);
      expect(validateScriptParams(r.remediation.scriptId, r.remediation.params).ok).toBe(true);
    }
  });

  it('every stage except register has agent rules', () => {
    for (const s of ['image', 'config', 'hardware', 'bios']) {
      expect(DEFAULT_RULES.some((r) => r.stage === s && r.context === 'agent')).toBe(true);
    }
  });

  it('resolves every @golden reference against the real manifest', () => {
    const resolved = resolvePolicy(DEFAULT_RULES, golden);
    const json = JSON.stringify(resolved);
    expect(json).not.toContain('@golden:');
    expect(json).not.toContain('TBD(golden:'); // no reference to a missing key
    const disk = resolved.find((r) => r.id === 'disk.data.present')!;
    expect(disk.params).toMatchObject({ aspect: 'present', minBytes: 3.8e12, maxBytes: 4.1e12 });
    const apn = resolved.find((r) => r.id === 'cell.apn')!;
    expect(apn.params).toEqual({ apn: { profileName: 'AA FirstNet', apn: '32871.fn' } });
  });

  it('flags missing golden keys as TBD', () => {
    const r = resolvePolicy(DEFAULT_RULES, {});
    expect(isTbd(r.find((x) => x.id === 'os.build')!.params.build)).toBe(true);
  });
});

describe('script whitelist', () => {
  it('rejects unknown scripts and bad params', () => {
    expect(validateScriptParams('rm-rf', {}).ok).toBe(false);
    expect(validateScriptParams('lsapl-restore-file', { file: '../../etc/passwd' }).ok).toBe(false);
    expect(validateScriptParams('delete-shortcut', { pattern: '*.lnk' }).ok).toBe(false);
    expect(validateScriptParams('ff-disable-startup', { extra: 1 }).ok).toBe(false);
    expect(validateScriptParams('lsapl-restore-file', { file: 'truststore' }).ok).toBe(true);
  });
});

describe('isTbd', () => {
  it('detects placeholders', () => {
    expect(isTbd('TBD(P0-4)')).toBe(true);
    expect(isTbd(['TBD'])).toBe(true);
    expect(isTbd(null)).toBe(true);
    expect(isTbd('26100')).toBe(false);
    expect(isTbd([])).toBe(false);
  });
});
