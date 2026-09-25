import { describe, it, expect } from 'vitest';
import {
  CONTRACTS_VERSION,
  Attestation,
  Result,
  Rule,
  Run,
  computeReadiness,
  isStale,
  type ManualItem,
  type Result as ResultT,
  type Rule as RuleT,
} from './index.js';

const AT = '2026-09-26T14:03:11Z';

const rule = (id: string, stage: RuleT['stage'], severity: RuleT['severity'] = 'critical'): RuleT =>
  Rule.parse({ id, name: id, stage, type: 'fileHash', severity });

const res = (ruleId: string, status: ResultT['status'], skipReason: ResultT['skipReason'] = null): ResultT =>
  Result.parse({ ruleId, status, skipReason, durationMs: 5, checkedAt: AT });

describe('contracts package', () => {
  it('exports a version string', () => {
    expect(CONTRACTS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('schemas', () => {
  it('parses the §5.1 rule sample', () => {
    const r = Rule.parse({
      id: 'lsapl.truststore',
      name: 'LSAPL trust store present and correct',
      stage: 'config',
      type: 'fileHash',
      params: { path: 'C:\\Boeing\\LSAPL-SMT\\Keys\\ee-prod-smt-trust.jks' },
      severity: 'critical',
      timeoutMs: 10000,
      remediation: { scriptId: 'lsapl-restore-file', params: { file: 'truststore' }, auto: false },
    });
    expect(r.remediation?.scriptId).toBe('lsapl-restore-file');
  });

  it('rejects bad rule ids and script ids', () => {
    expect(() => rule('NoDots', 'image')).toThrow();
    expect(() =>
      Rule.parse({ id: 'a.b', name: 'x', stage: 'image', type: 't', severity: 'warn', remediation: { scriptId: 'rm -rf /' } }),
    ).toThrow();
  });

  it('rejects the manual-only register stage on rules', () => {
    expect(() => rule('reg.central', 'register' as RuleT['stage'])).toThrow();
  });

  it('enforces skip <-> skipReason pairing', () => {
    expect(() => res('a.b', 'skip')).toThrow(/skipReason/);
    expect(() => res('a.b', 'pass', 'precondition')).toThrow(/skipReason/);
    expect(res('a.b', 'skip', 'precondition').skipReason).toBe('precondition');
  });

  it('caps evidence at 8 KB', () => {
    expect(() =>
      Result.parse({ ruleId: 'a.b', status: 'pass', evidence: { blob: 'x'.repeat(9000) }, durationMs: 1, checkedAt: AT }),
    ).toThrow(/8 KB/);
  });

  it('requires a uuid runId', () => {
    expect(() => Run.parse({ runId: 'nope', trigger: 'manual', startedAt: AT, finishedAt: AT, results: [] })).toThrow();
  });

  it('attestation needs exactly one target', () => {
    expect(() => Attestation.parse({ by: 'tech', at: AT })).toThrow();
    expect(() => Attestation.parse({ itemId: 'a.b', ruleId: 'c.d', by: 'tech', at: AT })).toThrow();
    expect(Attestation.parse({ itemId: 'a.b', by: 'tech', at: AT }).itemId).toBe('a.b');
  });
});

describe('computeReadiness (§5.3)', () => {
  const rules = [
    rule('disk.data.present', 'hardware'),
    rule('ui.wallpaper', 'image', 'warn'),
    rule('bios.secureboot', 'bios'),
  ];
  const items: ManualItem[] = [{ id: 'reg.central', stage: 'register', label: 'Added to Central' }];
  const attestItem = [{ itemId: 'reg.central', by: 'tech', at: AT }];
  const allPass = rules.map((r) => res(r.id, 'pass'));

  it('ready: everything passes and manual items attested', () => {
    const out = computeReadiness({ rules, results: allPass, manualItems: items, attestations: attestItem });
    expect(out.readiness).toBe('ready');
    expect(Object.values(out.stages).every((s) => s === 'complete')).toBe(true);
  });

  it('not-ready: a critical rule fails', () => {
    const results = [res('disk.data.present', 'fail'), res('ui.wallpaper', 'pass'), res('bios.secureboot', 'pass')];
    const out = computeReadiness({ rules, results, manualItems: items, attestations: attestItem });
    expect(out.readiness).toBe('not-ready');
    expect(out.stages.hardware).toBe('failing');
  });

  it('not-ready: a critical check errors (state unknown)', () => {
    const results = [res('disk.data.present', 'error'), res('ui.wallpaper', 'pass'), res('bios.secureboot', 'pass')];
    expect(computeReadiness({ rules, results, manualItems: items, attestations: attestItem }).readiness).toBe('not-ready');
  });

  it('degraded: only a warn rule fails, nothing pending', () => {
    const results = [res('disk.data.present', 'pass'), res('ui.wallpaper', 'fail'), res('bios.secureboot', 'pass')];
    expect(computeReadiness({ rules, results, manualItems: items, attestations: attestItem }).readiness).toBe('degraded');
  });

  it('in-progress beats degraded while work is pending', () => {
    const results = [res('disk.data.present', 'pass'), res('ui.wallpaper', 'fail'), res('bios.secureboot', 'pass')];
    expect(computeReadiness({ rules, results, manualItems: items, attestations: [] }).readiness).toBe('in-progress');
  });

  it('in-progress: precondition skip and missing results are pending', () => {
    const results = [res('disk.data.present', 'skip', 'precondition'), res('ui.wallpaper', 'pass')];
    const out = computeReadiness({ rules, results, manualItems: items, attestations: attestItem });
    expect(out.readiness).toBe('in-progress');
    expect(out.stages.hardware).toBe('pending');
    expect(out.stages.bios).toBe('pending');
  });

  it('not_applicable skip counts as done', () => {
    const results = [...allPass.slice(0, 2), res('bios.secureboot', 'skip', 'not_applicable')];
    expect(computeReadiness({ rules, results, manualItems: items, attestations: attestItem }).readiness).toBe('ready');
  });

  it('needs_human stays pending until attested, then counts as done', () => {
    const results = [...allPass.slice(0, 2), res('bios.secureboot', 'needs_human')];
    expect(computeReadiness({ rules, results, manualItems: items, attestations: attestItem }).readiness).toBe('in-progress');
    const attested = [...attestItem, { ruleId: 'bios.secureboot', by: 'tech', at: AT }];
    expect(computeReadiness({ rules, results, manualItems: items, attestations: attested }).readiness).toBe('ready');
  });

  it('an attested failure no longer blocks', () => {
    const results = [res('disk.data.present', 'fail'), ...allPass.slice(1)];
    const attested = [...attestItem, { ruleId: 'disk.data.present', by: 'lead', at: AT, note: 'accepted' }];
    expect(computeReadiness({ rules, results, manualItems: items, attestations: attested }).readiness).toBe('ready');
  });
});

describe('isStale', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  it('fresh within 10 min, stale after, stale on garbage', () => {
    expect(isStale('2026-09-26T11:55:00Z', now)).toBe(false);
    expect(isStale('2026-09-26T11:49:00Z', now)).toBe(true);
    expect(isStale('not-a-date', now)).toBe(true);
  });
});
