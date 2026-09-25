import { describe, it, expect } from 'vitest';
import { banner, AGENT_VERSION } from './index.js';

describe('agent entry', () => {
  it('reports version in banner', () => {
    expect(banner()).toContain(AGENT_VERSION);
    expect(banner()).toContain('contracts');
  });
});
