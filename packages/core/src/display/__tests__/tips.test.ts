import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showTips, showTip } from '../tips.js';
import colors from 'ansi-colors';

// Mock console.log
const originalConsoleLog = console.log;
let consoleOutput: string[] = [];

describe('tips', () => {
  beforeEach(() => {
    consoleOutput = [];
    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  describe('showTips', () => {
    it('should display a single tip as string', () => {
      showTips('run `rover logs 12` to check logs');

      expect(console.log).toHaveBeenCalled();
      const output = consoleOutput.join('\n');
      expect(output).toContain('Tip:');
      expect(output).toContain('run `rover logs 12` to check logs');
    });

    it('should display multiple tips from array', () => {
      showTips([
        'run `rover logs 12` to check logs',
        'use `rover status` to see task status',
      ]);

      const output = consoleOutput.join('\n');
      expect(output).toContain('run `rover logs 12` to check logs');
      expect(output).toContain('use `rover status` to see task status');
    });

    it('should use cyan color for Tip: prefix', () => {
      showTips('test tip');

      const output = consoleOutput.join('\n');
      expect(output).toContain(colors.cyan('Tip:'));
    });

    it('should use gray color for tip message', () => {
      showTips('test message');

      const output = consoleOutput.join('\n');
      expect(output).toContain(colors.gray(' test message'));
    });

    it('should limit tips to maximum of 2', () => {
      showTips(['tip 1', 'tip 2', 'tip 3', 'tip 4']);

      // Should only show 2 tips (plus potential line break)
      const tipLines = consoleOutput.filter(line => line.includes('Tip:'));
      expect(tipLines.length).toBe(2);
    });

    it('should add line break before tips by default', () => {
      showTips('test tip');

      // First call should be empty line (line break)
      expect(consoleOutput[0]).toBe('');
    });

    it('should not add line break when addLineBreak is false', () => {
      showTips('test tip', { addLineBreak: false });

      // First call should be the tip, not an empty line
      expect(consoleOutput[0]).toContain('Tip:');
    });

    it('should handle empty array', () => {
      showTips([]);

      // Should only have the line break
      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toBe('');
    });

    it('should handle unicode characters in tips', () => {
      showTips('使用 `rover status` 查看状态 🚀');

      const output = consoleOutput.join('\n');
      expect(output).toContain('使用 `rover status` 查看状态 🚀');
    });

    it('should handle very long tip messages', () => {
      const longTip = 'A'.repeat(200);
      showTips(longTip);

      const output = consoleOutput.join('\n');
      expect(output).toContain(longTip);
    });

    it('should handle special characters in tips', () => {
      showTips('use `rover task --name="My Task"` to create a task');

      const output = consoleOutput.join('\n');
      expect(output).toContain(
        'use `rover task --name="My Task"` to create a task'
      );
    });

    it('should display each tip on a separate line', () => {
      showTips(['tip 1', 'tip 2']);

      // Should have line break + 2 tip lines
      expect(consoleOutput.length).toBeGreaterThanOrEqual(3);
      const tipLines = consoleOutput.filter(line => line.includes('Tip:'));
      expect(tipLines.length).toBe(2);
    });
  });

  describe('showTip', () => {
    it('should display a single tip', () => {
      showTip('test tip message');

      const output = consoleOutput.join('\n');
      expect(output).toContain('Tip:');
      expect(output).toContain('test tip message');
    });

    it('should add line break by default', () => {
      showTip('test');

      expect(consoleOutput[0]).toBe('');
    });
  });
});
