import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showSplashHeader, showRegularHeader } from '../header.js';
import colors from 'ansi-colors';

// Mock console.log
const originalConsoleLog = console.log;
let consoleOutput: string[] = [];

describe('header', () => {
  beforeEach(() => {
    consoleOutput = [];
    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  describe('showSplashHeader', () => {
    it('should display the ROVER banner', () => {
      showSplashHeader();

      expect(console.log).toHaveBeenCalled();
      const output = consoleOutput.join('\n');
      // Should contain the ROVER text (without ANSI codes for testing)
      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(0);
    });

    it('should output multiple lines for the banner', () => {
      showSplashHeader();

      // The banner has 4 lines
      const output = consoleOutput[0];
      const lines = output.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(4);
    });

    it('should apply colors to the banner', () => {
      showSplashHeader();

      const output = consoleOutput[0];
      // Should contain ANSI color codes
      expect(output).toMatch(/\x1b\[/); // ANSI escape sequence
    });

    it('should use gradient colors when true color is supported', () => {
      const originalColorterm = process.env.COLORTERM;
      process.env.COLORTERM = 'truecolor';

      showSplashHeader();

      const output = consoleOutput[0];
      // True color uses RGB codes: \x1b[38;2;R;G;Bm
      expect(output).toMatch(/\x1b\[38;2;/);

      process.env.COLORTERM = originalColorterm;
    });

    it('should fallback to cyan when true color is not supported', () => {
      const originalColorterm = process.env.COLORTERM;
      const originalTerm = process.env.TERM;
      const originalTermProgram = process.env.TERM_PROGRAM;
      const originalForceColor = process.env.FORCE_COLOR;

      delete process.env.COLORTERM;
      delete process.env.TERM;
      delete process.env.TERM_PROGRAM;
      delete process.env.FORCE_COLOR;

      showSplashHeader();

      const output = consoleOutput[0];
      // Should still have some color codes (cyan)
      expect(output).toMatch(/\x1b\[/);

      process.env.COLORTERM = originalColorterm;
      process.env.TERM = originalTerm;
      process.env.TERM_PROGRAM = originalTermProgram;
      process.env.FORCE_COLOR = originalForceColor;
    });
  });

  describe('showRegularHeader', () => {
    it('should display header with version and context', () => {
      showRegularHeader('1.3.0', '/home/user/workspace/project');

      expect(console.log).toHaveBeenCalledTimes(2);
      const [headerLine, separatorLine] = consoleOutput;

      // Header should contain Rover, version, and path
      expect(headerLine).toContain('Rover');
      expect(headerLine).toContain('1.3.0');
      expect(headerLine).toContain('/home/user/workspace/project');
    });

    it('should format version with v prefix', () => {
      showRegularHeader('2.0.0', '/path');

      const headerLine = consoleOutput[0];
      expect(headerLine).toContain('v2.0.0');
    });

    it('should use cyan color for Rover text', () => {
      showRegularHeader('1.0.0', '/path');

      const headerLine = consoleOutput[0];
      expect(headerLine).toContain(colors.cyan('Rover'));
    });

    it('should display separator line', () => {
      showRegularHeader('1.0.0', '/path');

      expect(consoleOutput.length).toBe(2);
      const separatorLine = consoleOutput[1];
      // Separator should contain dashes
      expect(separatorLine).toMatch(/-+/);
    });

    it('should handle short paths', () => {
      showRegularHeader('1.0.0', '/');

      const [headerLine] = consoleOutput;
      expect(headerLine).toContain('/');
    });

    it('should handle unicode in paths', () => {
      showRegularHeader('1.0.0', '/home/用户/项目');

      const [headerLine] = consoleOutput;
      expect(headerLine).toContain('/home/用户/项目');
    });

    it('should use gray color for version and context', () => {
      showRegularHeader('1.0.0', '/path');

      const headerLine = consoleOutput[0];
      // Both version and context should use gray color
      expect(headerLine).toContain(colors.gray('(v1.0.0)'));
      expect(headerLine).toContain(colors.gray('/path'));
    });

    it('should use · separator between version and context', () => {
      showRegularHeader('1.0.0', '/path');

      const headerLine = consoleOutput[0];
      expect(headerLine).toContain('·');
    });
  });
});
