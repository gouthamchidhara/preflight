import { describe, it, expect } from 'vitest';
import { MOCK_AGENT_NAME } from './index.js';

describe('mock-agent entry', () => {
  it('has a stable name', () => {
    expect(MOCK_AGENT_NAME).toBe('mock-agent');
  });
});
