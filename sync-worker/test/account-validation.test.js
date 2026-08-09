import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../src/account.js';

describe('account input validation', () => {
  it('normalizes ordinary email addresses', () => {
    expect(normalizeEmail('  Henrik@Example.COM ')).toBe('henrik@example.com');
  });

  it('rejects malformed, missing, and oversized addresses', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail('henrik')).toBeNull();
    expect(normalizeEmail('a @example.com')).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@example.com`)).toBeNull();
  });
});
