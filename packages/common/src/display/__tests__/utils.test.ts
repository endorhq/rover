import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supportsTrueColor, rgb } from '../utils.js';

describe('utils', () => {
  // Store original env vars
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('supportsTrueColor', () => {
    it('should return true when COLORTERM is truecolor', () => {
      process.env.COLORTERM = 'truecolor';

      expect(supportsTrueColor()).toBe(true);
    });

    it('should return true when TERM_PROGRAM is iTerm.app', () => {
      delete process.env.COLORTERM;
      process.env.TERM_PROGRAM = 'iTerm.app';

      expect(supportsTrueColor()).toBe(true);
    });

    it('should return true when TERM_PROGRAM is vscode', () => {
      delete process.env.COLORTERM;
      process.env.TERM_PROGRAM = 'vscode';

      expect(supportsTrueColor()).toBe(true);
    });

    it('should return true when TERM is xterm-256color', () => {
      delete process.env.COLORTERM;
      delete process.env.TERM_PROGRAM;
      process.env.TERM = 'xterm-256color';

      expect(supportsTrueColor()).toBe(true);
    });

    it('should return true when TERM is tmux-256color', () => {
      delete process.env.COLORTERM;
      delete process.env.TERM_PROGRAM;
      process.env.TERM = 'tmux-256color';

      expect(supportsTrueColor()).toBe(true);
    });

    it('should return true when FORCE_COLOR is 3', () => {
      delete process.env.COLORTERM;
      delete process.env.TERM_PROGRAM;
      delete process.env.TERM;
      process.env.FORCE_COLOR = '3';

      expect(supportsTrueColor()).toBe(true);
    });

    it('should return false when no true color indicators are set', () => {
      delete process.env.COLORTERM;
      delete process.env.TERM_PROGRAM;
      delete process.env.TERM;
      delete process.env.FORCE_COLOR;

      expect(supportsTrueColor()).toBe(false);
    });

    it('should return false when FORCE_COLOR is not 3', () => {
      delete process.env.COLORTERM;
      delete process.env.TERM_PROGRAM;
      delete process.env.TERM;
      process.env.FORCE_COLOR = '1';

      expect(supportsTrueColor()).toBe(false);
    });

    it('should return false when TERM is not 256color variant', () => {
      delete process.env.COLORTERM;
      delete process.env.TERM_PROGRAM;
      process.env.TERM = 'xterm';
      delete process.env.FORCE_COLOR;

      expect(supportsTrueColor()).toBe(false);
    });

    it('should prioritize COLORTERM over other settings', () => {
      process.env.COLORTERM = 'truecolor';
      process.env.TERM = 'basic';

      expect(supportsTrueColor()).toBe(true);
    });
  });

  describe('rgb', () => {
    it('should generate RGB ANSI escape sequence', () => {
      const result = rgb(255, 0, 0, 'Red Text');

      expect(result).toContain('\x1b[38;2;255;0;0m');
      expect(result).toContain('Red Text');
      expect(result).toContain('\x1b[0m');
    });

    it('should wrap text with correct RGB values', () => {
      const result = rgb(100, 150, 200, 'Test');

      expect(result).toBe('\x1b[38;2;100;150;200mTest\x1b[0m');
    });

    it('should handle RGB value 0', () => {
      const result = rgb(0, 0, 0, 'Black');

      expect(result).toContain('\x1b[38;2;0;0;0m');
      expect(result).toContain('Black');
    });

    it('should handle RGB value 255', () => {
      const result = rgb(255, 255, 255, 'White');

      expect(result).toContain('\x1b[38;2;255;255;255m');
      expect(result).toContain('White');
    });

    it('should handle empty text', () => {
      const result = rgb(100, 100, 100, '');

      expect(result).toBe('\x1b[38;2;100;100;100m\x1b[0m');
    });

    it('should handle text with special characters', () => {
      const result = rgb(50, 100, 150, 'Text with 🚀 emoji');

      expect(result).toContain('Text with 🚀 emoji');
    });

    it('should handle unicode text', () => {
      const result = rgb(200, 50, 100, '你好世界');

      expect(result).toContain('\x1b[38;2;200;50;100m');
      expect(result).toContain('你好世界');
    });

    it('should reset color after text', () => {
      const result = rgb(100, 100, 100, 'Test');

      expect(result.endsWith('\x1b[0m')).toBe(true);
    });

    it('should handle multiline text', () => {
      const result = rgb(100, 100, 100, 'Line 1\nLine 2');

      expect(result).toContain('Line 1\nLine 2');
      expect(result).toContain('\x1b[38;2;100;100;100m');
    });

    it('should generate teal color correctly', () => {
      // Teal 400: rgb(45, 212, 191)
      const result = rgb(45, 212, 191, 'Teal');

      expect(result).toBe('\x1b[38;2;45;212;191mTeal\x1b[0m');
    });

    it('should handle single character', () => {
      const result = rgb(255, 0, 0, 'A');

      expect(result).toBe('\x1b[38;2;255;0;0mA\x1b[0m');
    });

    it('should handle long text', () => {
      const longText = 'A'.repeat(1000);
      const result = rgb(100, 100, 100, longText);

      expect(result).toContain(longText);
      expect(result.startsWith('\x1b[38;2;100;100;100m')).toBe(true);
      expect(result.endsWith('\x1b[0m')).toBe(true);
    });
  });
});
