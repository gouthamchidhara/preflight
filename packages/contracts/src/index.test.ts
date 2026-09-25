import { describe, it, expect } from 'vitest';
import { CONTRACTS_VERSION } from './index.js';

describe('contracts package', () => {
  it('exports a version string', () => {
    expect(CONTRACTS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
