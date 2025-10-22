import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock boxen - must be hoisted before imports
vi.mock('boxen', () => ({
  default: vi.fn((content: string, options: unknown) => {
    return `[BOXEN: ${JSON.stringify(options)}]\n${content}\n[/BOXEN]`;
  }),
}));

import { showFile } from '../content.js';
import boxen from 'boxen';

const mockBoxen = boxen as unknown as ReturnType<typeof vi.fn>;

// Mock console.log
const originalConsoleLog = console.log;
let consoleOutput: string[] = [];

describe('showFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it('should display file content with boxen', () => {
    showFile('context.md', 'foo bar foo bar');

    expect(mockBoxen).toHaveBeenCalledTimes(1);
    expect(mockBoxen).toHaveBeenCalledWith('foo bar foo bar', {
      title: 'context.md',
      borderColor: 'gray',
    });
    expect(console.log).toHaveBeenCalled();
  });

  it('should use filename as boxen title', () => {
    showFile('package.json', '{"name": "test"}');

    expect(mockBoxen).toHaveBeenCalledWith('{"name": "test"}', {
      title: 'package.json',
      borderColor: 'gray',
    });
  });

  it('should use gray border color', () => {
    showFile('test.txt', 'content');

    const call = mockBoxen.mock.calls[0];
    expect(call[1]).toHaveProperty('borderColor', 'gray');
  });

  it('should handle empty content', () => {
    showFile('empty.txt', '');

    expect(mockBoxen).toHaveBeenCalledWith('-', {
      title: 'empty.txt',
      borderColor: 'gray',
    });
  });

  it('should handle unicode characters in content', () => {
    showFile('unicode.txt', 'Hello 世界 🚀');

    expect(mockBoxen).toHaveBeenCalledWith('Hello 世界 🚀', {
      title: 'unicode.txt',
      borderColor: 'gray',
    });
  });
});
