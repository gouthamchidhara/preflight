import { describe, it, expect } from 'vitest';
import { Result } from '@umd/contracts';
import { MOCK_AGENT_NAME, resultsFor } from './index.js';

describe('mock-agent', () => {
  it('has a stable name', () => expect(MOCK_AGENT_NAME).toBe('mock-agent'));

  it('produces contract-valid results for every profile', () => {
    for (const p of ['ready', 'disk-missing', 'lsapl-broken', 'sim-pending', 'wallpaper'] as const) {
      for (const r of resultsFor(p)) expect(Result.safeParse(r).success).toBe(true);
    }
  });

  it('fixed rules report pass', () => {
    const r = resultsFor('lsapl-broken', undefined, new Set(['lsapl.truststore']));
    expect(r.find((x) => x.ruleId === 'lsapl.truststore')!.status).toBe('pass');
  });
});
