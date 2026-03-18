import { describe, it, expect } from 'vitest';
import { formatDuration } from '../display.js';

describe('formatDuration', () => {
  it('returns "--" when no start time provided', () => {
    expect(formatDuration()).toBe('--');
    expect(formatDuration(undefined)).toBe('--');
  });

  it('formats seconds correctly', () => {
    expect(
      formatDuration('2026-03-01T10:00:00.000Z', '2026-03-01T10:00:45.000Z')
    ).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(
      formatDuration('2026-03-01T10:00:00.000Z', '2026-03-01T10:02:30.000Z')
    ).toBe('2m 30s');
  });

  it('formats hours and minutes', () => {
    expect(
      formatDuration('2026-03-01T10:00:00.000Z', '2026-03-01T11:15:00.000Z')
    ).toBe('1h 15m');
  });
});
