import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showTitle } from '../title.js';
import colors from 'ansi-colors';

// Mock console.log
const originalConsoleLog = console.log;
let consoleOutput: string[] = [];

describe('showTitle', () => {
  beforeEach(() => {
    consoleOutput = [];
    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it('should display a title with separator', () => {
    showTitle('Test Title');

    expect(console.log).toHaveBeenCalledTimes(3);
    expect(consoleOutput.length).toBe(3);
  });

  it('should add line break before title', () => {
    showTitle('Title');

    // First call should be empty line
    expect(consoleOutput[0]).toBe('');
  });

  it('should use bold cyan for title text', () => {
    showTitle('My Title');

    const titleLine = consoleOutput[1];
    expect(titleLine).toContain(colors.bold(colors.cyan('My Title')));
  });

  it('should display separator line with dashes', () => {
    showTitle('Title');

    const separatorLine = consoleOutput[2];
    const separatorWithoutAnsi = separatorLine.replace(/\x1b\[[0-9;]*m/g, '');
    expect(separatorWithoutAnsi).toMatch(/^-+$/);
  });

  it('should match separator length to title length', () => {
    const title = 'This is a test title';
    showTitle(title);

    const separatorLine = consoleOutput[2];
    // Strip ANSI codes to get actual character count
    const titleWithoutAnsi = consoleOutput[1].replace(/\x1b\[[0-9;]*m/g, '');
    const separatorWithoutAnsi = separatorLine.replace(/\x1b\[[0-9;]*m/g, '');

    expect(separatorWithoutAnsi.length).toBe(titleWithoutAnsi.length);
  });

  it('should use gray color for separator', () => {
    showTitle('Title');

    const separatorLine = consoleOutput[2];
    // Check that the separator contains gray ANSI codes
    expect(separatorLine).toMatch(/\x1b\[90m/);
  });

  it('should handle short titles', () => {
    showTitle('A');

    const separatorLine = consoleOutput[2];
    const separatorWithoutAnsi = separatorLine.replace(/\x1b\[[0-9;]*m/g, '');
    expect(separatorWithoutAnsi).toMatch(/^-+$/);
    expect(separatorLine.length).toBeGreaterThan(0);
  });

  it('should handle long titles', () => {
    const longTitle = 'This is a very long title that spans many characters';
    showTitle(longTitle);

    const titleLine = consoleOutput[1];
    expect(titleLine).toContain(longTitle);
  });

  it('should handle unicode characters', () => {
    showTitle('标题 Title タイトル');

    const titleLine = consoleOutput[1];
    expect(titleLine).toContain('标题 Title タイトル');
  });
});
