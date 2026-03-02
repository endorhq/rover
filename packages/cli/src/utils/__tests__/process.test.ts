import { describe, it, expect, vi, afterEach } from 'vitest';
import { isProcessAlive } from '../process.js';

describe('isProcessAlive', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a non-existent PID (ESRCH)', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
    });
    expect(isProcessAlive(99999999)).toBe(false);
  });

  it('returns true when process exists but we lack permission (EPERM)', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Operation not permitted'), {
        code: 'EPERM',
      });
    });
    expect(isProcessAlive(1)).toBe(true);
  });

  it('returns false for invalid PID values', () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(NaN)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
  });

  it('returns false for unknown error codes', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Unknown error'), { code: 'EUNKNOWN' });
    });
    expect(isProcessAlive(12345)).toBe(false);
  });
});
