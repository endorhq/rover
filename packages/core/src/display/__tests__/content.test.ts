import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showFile } from '../content.js';
import boxen from 'boxen';

// Mock console.log to capture output
const originalConsoleLog = console.log;
let consoleOutput: string[] = [];

describe('showFile', () => {
  beforeEach(() => {
    consoleOutput = [];
    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it('should display file content with boxen', () => {
    showFile('context.md', 'foo bar');

    expect(console.log).toHaveBeenCalledTimes(1);
    const output = consoleOutput[0];

    // Should contain the content
    expect(output).toContain('foo bar');

    // Should have box characters (single border style)
    expect(output).toMatch(/[┌┐└┘│─]/);
  });

  it('should use filename as boxen title', () => {
    showFile('package.json', '{"name": "test"}');

    const output = consoleOutput[0];

    // Title should be in the output
    expect(output).toContain('package.json');
    expect(output).toContain('{"name": "test"}');
  });

  it('should use gray border color', () => {
    showFile('test.txt', 'content');

    const output = consoleOutput[0];

    // Verify output matches boxen with gray border
    const expected = boxen('content', {
      title: 'test.txt',
      borderColor: 'gray',
      padding: 1,
    });

    expect(output).toBe(expected);
  });

  it('should display empty content as a dash', () => {
    showFile('empty.txt', '');

    const output = consoleOutput[0];

    // When content is empty, showFile displays a dash
    expect(output).toContain('-');
    expect(output).toContain('empty.txt');
  });

  it('should handle multiline content', () => {
    const multilineContent = 'Line 1\nLine 2\nLine 3';
    showFile('multiline.txt', multilineContent);

    const output = consoleOutput[0];

    // All lines should be in the output
    expect(output).toContain('Line 1');
    expect(output).toContain('Line 2');
    expect(output).toContain('Line 3');
    expect(output).toContain('multiline.txt');
  });

  it('should handle special characters in filename', () => {
    showFile('file-with-dashes_and_underscores.txt', 'content');

    const output = consoleOutput[0];

    expect(output).toContain('file-with-dashes_and_underscores.txt');
    expect(output).toContain('content');
  });

  it('should handle unicode characters in content', () => {
    showFile('unicode.txt', 'Hello 世界 🚀');

    const output = consoleOutput[0];

    expect(output).toContain('Hello 世界 🚀');
    expect(output).toContain('unicode.txt');
  });

  it('should match boxen output format', () => {
    const filename = 'test.txt';
    const content = 'test content';

    showFile(filename, content);

    // Create expected boxen output for comparison
    const expectedBoxen = boxen(content, {
      title: filename,
      borderColor: 'gray',
      padding: 1,
    });

    expect(consoleOutput[0]).toBe(expectedBoxen);
  });

  it('should handle paths in filename', () => {
    showFile('src/components/Button.tsx', 'export const Button = () => {}');

    const output = consoleOutput[0];

    expect(output).toContain('src/components/Button.tsx');
    expect(output).toContain('export const Button = () => {}');
  });

  it('should create box with default single border style', () => {
    showFile('file.txt', 'content');

    const output = consoleOutput[0];

    // Single border style uses these characters
    expect(output).toMatch(/┌.*┐/); // Top corners
    expect(output).toMatch(/└.*┘/); // Bottom corners
  });

  it('should display title at the top of the box', () => {
    showFile('example.md', 'content');

    const output = consoleOutput[0];
    const lines = output.split('\n');

    // First line should contain the title and top border
    expect(lines[0]).toContain('example.md');
    expect(lines[0]).toContain('┌');
  });

  it('should wrap content inside box borders', () => {
    showFile('test.txt', 'wrapped content');

    const output = consoleOutput[0];
    const lines = output.split('\n');

    // Content lines should have vertical borders on both sides
    const contentLine = lines.find(line => line.includes('wrapped content'));
    expect(contentLine).toBeDefined();
    expect(contentLine).toMatch(/│.*wrapped content.*│/);
  });

  it('should produce complete box structure with all borders', () => {
    showFile('example.txt', 'Hello World');

    const output = consoleOutput[0];
    const lines = output.split('\n');

    // Should have exactly 5 lines: top border with title, content, bottom border + padding
    expect(lines.length).toBe(5);

    // First line: top border with title
    expect(lines[0]).toMatch(/┌.*example\.txt.*┐/);

    // Second line: content with side borders
    expect(lines[2]).toMatch(/│.*Hello World.*│/);

    // Third line: bottom border
    expect(lines[4]).toMatch(/└.*┘/);

    // Verify the complete structure matches expected boxen output
    const expected = boxen('Hello World', {
      title: 'example.txt',
      borderColor: 'gray',
      padding: 1,
    });
    expect(output).toBe(expected);
  });

  it('should produce complete box structure with multiline content', () => {
    const content = 'Line 1\nLine 2\nLine 3';
    showFile('multi.txt', content);

    const output = consoleOutput[0];
    const lines = output.split('\n');

    // Should have 7 lines: top border, 3 content lines, bottom border, + padding
    expect(lines.length).toBe(7);

    // Top border with title
    expect(lines[0]).toMatch(/┌.*multi\.txt.*┐/);

    // Three content lines, each with side borders
    expect(lines[2]).toMatch(/│.*Line 1.*│/);
    expect(lines[3]).toMatch(/│.*Line 2.*│/);
    expect(lines[4]).toMatch(/│.*Line 3.*│/);

    // Bottom border
    expect(lines[6]).toMatch(/└.*┘/);

    // Verify complete output matches boxen
    const expected = boxen(content, {
      title: 'multi.txt',
      borderColor: 'gray',
      padding: 1,
    });
    expect(output).toBe(expected);
  });

  it('should match exact boxen output for complex content', () => {
    const content =
      'export const Button = () => {\n  return <button>Click</button>;\n};';
    const filename = 'Button.tsx';

    showFile(filename, content);

    // Generate expected output
    const expected = boxen(content, {
      title: filename,
      borderColor: 'gray',
      padding: 1,
    });

    // Should match exactly
    expect(consoleOutput[0]).toBe(expected);

    // Verify it has the complete structure
    const lines = consoleOutput[0].split('\n');
    expect(lines.length).toBeGreaterThan(3); // At least top, content, bottom
    expect(lines[0]).toContain('Button.tsx');
    expect(lines[0]).toContain('┌');
    expect(lines[lines.length - 1]).toMatch(/└.*┘/);
  });
});
