import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showRoverHeader } from '../header.js';
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

  describe('showRoverHeader', () => {
    it('should display header with ASCII art and project info', () => {
      showRoverHeader({
        version: '1.3.0',
        agent: 'claude',
        projectPath: '/home/user/workspace/project',
      });

      // First line is blank, then 3 lines for the header
      expect(console.log).toHaveBeenCalledTimes(4);
    });

    it('should display version with v prefix', () => {
      showRoverHeader({
        version: '2.0.0',
        agent: 'claude',
        projectPath: '/path',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('v2.0.0');
    });

    it('should display Rover name', () => {
      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        projectPath: '/path',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Rover');
    });

    it('should display agent name', () => {
      showRoverHeader({
        version: '1.0.0',
        agent: 'gemini',
        projectPath: '/path',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('gemini');
    });

    it('should show (default) when defaultAgent is true', () => {
      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        defaultAgent: true,
        projectPath: '/path',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('(default)');
    });

    it('should show (selected) when defaultAgent is false', () => {
      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        defaultAgent: false,
        projectPath: '/path',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('(selected)');
    });

    it('should display project path', () => {
      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        projectPath: '/home/user/workspace/project',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('/home/user/workspace/project');
    });

    it('should display project name when provided', () => {
      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        projectPath: '/path',
        projectName: 'my-awesome-project',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('my-awesome-project');
    });

    it('should show "No Project" when projectName is not provided', () => {
      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        projectPath: '/path',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('No Project');
    });

    it('should display ASCII art characters', () => {
      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        projectPath: '/path',
      });

      const output = consoleOutput.join('\n');
      // Check for ASCII art box characters
      expect(output).toContain('╭');
      expect(output).toContain('╯');
    });

    it('should use true color when supported', () => {
      const originalColorterm = process.env.COLORTERM;
      process.env.COLORTERM = 'truecolor';

      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        projectPath: '/path',
      });

      const output = consoleOutput.join('\n');
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

      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        projectPath: '/path',
      });

      const output = consoleOutput.join('\n');
      // Should still have color codes (cyan fallback)
      expect(output).toMatch(/\x1b\[/);

      process.env.COLORTERM = originalColorterm;
      process.env.TERM = originalTerm;
      process.env.TERM_PROGRAM = originalTermProgram;
      process.env.FORCE_COLOR = originalForceColor;
    });

    it('should handle unicode in project path', () => {
      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        projectPath: '/home/用户/项目',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('/home/用户/项目');
    });

    it('should handle unicode in project name', () => {
      showRoverHeader({
        version: '1.0.0',
        agent: 'claude',
        projectPath: '/path',
        projectName: '项目名称',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('项目名称');
    });
  });
});
