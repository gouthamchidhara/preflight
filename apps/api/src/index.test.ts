import { describe, it, expect } from 'vitest';
import { API_NAME } from './index.js';

describe('api entry', () => {
  it('has a stable name', () => {
    expect(API_NAME).toBe('umd-validation-api');
  });
});
