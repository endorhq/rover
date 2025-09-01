import { describe, it, expect } from 'vitest';
import colors from 'ansi-colors';
import { formatTaskStatus, statusColor } from '../task-status.js';

describe('formatTaskStatus', () => {
  it('should format known statuses correctly', () => {
    expect(formatTaskStatus('NEW')).toBe('New');
    expect(formatTaskStatus('IN_PROGRESS')).toBe('In Progress');
    expect(formatTaskStatus('COMPLETED')).toBe('Completed');
    expect(formatTaskStatus('RUNNING')).toBe('Running');
    expect(formatTaskStatus('FAILED')).toBe('Failed');
    expect(formatTaskStatus('ITERATING')).toBe('Iterating');
    expect(formatTaskStatus('MERGED')).toBe('Merged');
    expect(formatTaskStatus('PUSHED')).toBe('Pushed');
  });

  it('should handle lowercase status inputs', () => {
    expect(formatTaskStatus('new')).toBe('New');
    expect(formatTaskStatus('in_progress')).toBe('In Progress');
    expect(formatTaskStatus('merged')).toBe('Merged');
    expect(formatTaskStatus('pushed')).toBe('Pushed');
  });

  it('should return unknown statuses as-is', () => {
    expect(formatTaskStatus('UNKNOWN_STATUS')).toBe('UNKNOWN_STATUS');
    expect(formatTaskStatus('some_other_status')).toBe('some_other_status');
  });
});

describe('statusColor', () => {
  it('should return correct colors for known statuses', () => {
    // Test by applying the color function to a test string and checking the result
    expect(statusColor('NEW')('test')).toBe(colors.cyan('test'));
    expect(statusColor('IN_PROGRESS')('test')).toBe(colors.yellow('test'));
    expect(statusColor('COMPLETED')('test')).toBe(colors.green('test'));
    expect(statusColor('RUNNING')('test')).toBe(colors.cyan('test'));
    expect(statusColor('ITERATING')('test')).toBe(colors.magenta('test'));
    expect(statusColor('FAILED')('test')).toBe(colors.red('test'));
    expect(statusColor('MERGED')('test')).toBe(colors.green('test'));
    expect(statusColor('PUSHED')('test')).toBe(colors.green('test'));
  });

  it('should handle lowercase status inputs', () => {
    expect(statusColor('new')('test')).toBe(colors.cyan('test'));
    expect(statusColor('merged')('test')).toBe(colors.green('test'));
    expect(statusColor('pushed')('test')).toBe(colors.green('test'));
  });

  it('should return gray color for unknown statuses', () => {
    expect(statusColor('UNKNOWN_STATUS')('test')).toBe(colors.gray('test'));
    expect(statusColor('some_other_status')('test')).toBe(colors.gray('test'));
  });
});
