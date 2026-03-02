import { describe, it, expect } from 'vitest';
import { formatError } from '../format-error.js';

describe('formatError', () => {
  it('returns message from Error instance', () => {
    const err = new Error('something broke');
    expect(formatError(err)).toBe('something broke');
  });

  it('returns string as-is', () => {
    expect(formatError('plain string error')).toBe('plain string error');
  });

  it('returns JSON for plain objects', () => {
    const obj = { code: 'ERR_LIMIT', detail: 'rate limited' };
    expect(formatError(obj)).toBe(JSON.stringify(obj, null, 2));
  });

  it('returns String() for numbers, booleans, null, and undefined', () => {
    expect(formatError(42)).toBe('42');
    expect(formatError(true)).toBe('true');
    expect(formatError(null)).toBe('null');
    expect(formatError(undefined)).toBe('undefined');
  });

  it('handles circular objects gracefully', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    // JSON.stringify will throw on circular references; formatError should fall back to String()
    expect(formatError(circular)).toBe('[object Object]');
  });
});
