import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showList } from '../list.js';

// Mock console.log to capture output
const originalConsoleLog = console.log;
let consoleOutput: string[] = [];

describe('showList', () => {
  beforeEach(() => {
    // Reset console output before each test
    consoleOutput = [];

    // Mock console.log
    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    });
  });

  afterEach(() => {
    // Restore console.log
    console.log = originalConsoleLog;
  });

  describe('basic list rendering', () => {
    it('should render a list with multiple items using correct tree symbols', () => {
      const items = ['changes.md', 'context.md', 'plan.md', 'summary.md'];
      showList(items);

      expect(consoleOutput).toEqual([
        '├── changes.md',
        '├── context.md',
        '├── plan.md',
        '└── summary.md',
      ]);
    });

    it('should use └── for all items except the last', () => {
      const items = ['file1.txt', 'file2.txt', 'file3.txt'];
      showList(items);

      expect(consoleOutput[0]).toMatch(/^├──/);
      expect(consoleOutput[1]).toMatch(/^├──/);
      expect(consoleOutput[2]).toMatch(/^└──/);
    });

    it('should add a space after tree symbols', () => {
      const items = ['test.txt'];
      showList(items);

      expect(consoleOutput[0]).toBe('└── test.txt');
    });
  });

  describe('with title option', () => {
    it('should display title above the list', () => {
      const items = ['file1.txt', 'file2.txt'];
      showList(items, { title: 'Iteration Files 1/1' });

      expect(consoleOutput[0]).toBe('Iteration Files 1/1');
      expect(consoleOutput[1]).toBe('├── file1.txt');
      expect(consoleOutput[2]).toBe('└── file2.txt');
    });

    it('should display title with default formatting (no special colors)', () => {
      const items = ['item.txt'];
      showList(items, { title: 'My List' });

      // Title should be plain text (no ANSI codes)
      expect(consoleOutput[0]).toBe('My List');
    });
  });

  describe('without title option', () => {
    it('should not display any title when title is not provided', () => {
      const items = ['file1.txt', 'file2.txt'];
      showList(items);

      expect(consoleOutput.length).toBe(2);
      expect(consoleOutput[0]).toBe('├── file1.txt');
    });

    it('should not display any title when title is undefined', () => {
      const items = ['file.txt'];
      showList(items, { title: undefined });

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toBe('└── file.txt');
    });
  });

  describe('single item list', () => {
    it('should use └── for a single item', () => {
      const items = ['only-file.txt'];
      showList(items);

      expect(consoleOutput).toEqual(['└── only-file.txt']);
    });

    it('should use └── for a single item even with title', () => {
      const items = ['single.txt'];
      showList(items, { title: 'Single File' });

      expect(consoleOutput[1]).toBe('└── single.txt');
    });
  });

  describe('empty array', () => {
    it('should display nothing for an empty array', () => {
      showList([]);

      expect(consoleOutput.length).toBe(0);
    });

    it('should display only title for an empty array when title is provided', () => {
      showList([], { title: 'No Files' });

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toBe('No Files');
    });
  });

  describe('addLineBreak option', () => {
    it('should add a line break before the list when addLineBreak is true', () => {
      const items = ['file1.txt', 'file2.txt'];
      showList(items, { addLineBreak: true });

      expect(consoleOutput[0]).toBe('');
      expect(consoleOutput[1]).toBe('├── file1.txt');
      expect(consoleOutput[2]).toBe('└── file2.txt');
    });

    it('should add a line break before title when both title and addLineBreak are provided', () => {
      const items = ['file.txt'];
      showList(items, { title: 'Files', addLineBreak: true });

      expect(consoleOutput[0]).toBe('');
      expect(consoleOutput[1]).toBe('Files');
      expect(consoleOutput[2]).toBe('└── file.txt');
    });

    it('should not add a line break when addLineBreak is false', () => {
      const items = ['file.txt'];
      showList(items, { addLineBreak: false });

      expect(consoleOutput[0]).not.toBe('');
      expect(consoleOutput[0]).toBe('└── file.txt');
    });

    it('should not add a line break when addLineBreak is not provided', () => {
      const items = ['file.txt'];
      showList(items);

      expect(consoleOutput[0]).not.toBe('');
      expect(consoleOutput[0]).toBe('└── file.txt');
    });
  });

  describe('special characters and unicode', () => {
    it('should handle items with special characters', () => {
      const items = [
        'file-with-dashes.txt',
        'file_with_underscores.txt',
        'file.multiple.dots.txt',
        'file (with parentheses).txt',
      ];
      showList(items);

      expect(consoleOutput).toEqual([
        '├── file-with-dashes.txt',
        '├── file_with_underscores.txt',
        '├── file.multiple.dots.txt',
        '└── file (with parentheses).txt',
      ]);
    });

    it('should handle items with unicode characters', () => {
      const items = ['文件.txt', 'archivo.txt', 'файл.txt', '📄 document.txt'];
      showList(items);

      expect(consoleOutput).toEqual([
        '├── 文件.txt',
        '├── archivo.txt',
        '├── файл.txt',
        '└── 📄 document.txt',
      ]);
    });

    it('should handle items with emojis', () => {
      const items = ['🚀 deploy.sh', '✅ test.js', '🔧 config.json'];
      showList(items);

      expect(consoleOutput[0]).toBe('├── 🚀 deploy.sh');
      expect(consoleOutput[1]).toBe('├── ✅ test.js');
      expect(consoleOutput[2]).toBe('└── 🔧 config.json');
    });

    it('should handle items with spaces', () => {
      const items = ['my file.txt', 'another file.txt'];
      showList(items);

      expect(consoleOutput[0]).toBe('├── my file.txt');
      expect(consoleOutput[1]).toBe('└── another file.txt');
    });
  });

  describe('very long item names', () => {
    it('should handle very long item names', () => {
      const longName = 'a'.repeat(200);
      const items = [longName, 'short.txt'];
      showList(items);

      expect(consoleOutput[0]).toBe(`├── ${longName}`);
      expect(consoleOutput[1]).toBe('└── short.txt');
    });

    it('should handle items with very long paths', () => {
      const items = [
        'src/components/features/authentication/forms/LoginForm.tsx',
        'src/components/features/authentication/forms/RegisterForm.tsx',
        'README.md',
      ];
      showList(items);

      expect(consoleOutput).toEqual([
        '├── src/components/features/authentication/forms/LoginForm.tsx',
        '├── src/components/features/authentication/forms/RegisterForm.tsx',
        '└── README.md',
      ]);
    });
  });

  describe('integration scenarios', () => {
    it('should render the example from the specification', () => {
      const items = ['changes.md', 'context.md', 'plan.md', 'summary.md'];
      showList(items, { title: 'Iteration Files 1/1' });

      expect(consoleOutput).toEqual([
        'Iteration Files 1/1',
        '├── changes.md',
        '├── context.md',
        '├── plan.md',
        '└── summary.md',
      ]);
    });

    it('should work with all options combined', () => {
      const items = ['file1.txt', 'file2.txt', 'file3.txt'];
      showList(items, {
        title: 'Project Files',
        addLineBreak: true,
      });

      expect(consoleOutput).toEqual([
        '',
        'Project Files',
        '├── file1.txt',
        '├── file2.txt',
        '└── file3.txt',
      ]);
    });

    it('should handle typical file listing scenario', () => {
      const items = [
        'package.json',
        'tsconfig.json',
        'README.md',
        '.gitignore',
        'src/index.ts',
      ];
      showList(items, { title: 'Project Root' });

      expect(consoleOutput[0]).toBe('Project Root');
      expect(consoleOutput.length).toBe(6); // title + 5 files
      expect(consoleOutput[5]).toMatch(/^└──/); // last item
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings as items', () => {
      const items = ['', 'file.txt', ''];
      showList(items);

      expect(consoleOutput).toEqual(['├── ', '├── file.txt', '└── ']);
    });

    it('should handle items that are only whitespace', () => {
      const items = ['   ', 'file.txt'];
      showList(items);

      expect(consoleOutput[0]).toBe('├──    ');
      expect(consoleOutput[1]).toBe('└── file.txt');
    });

    it('should handle title that is an empty string', () => {
      const items = ['file.txt'];
      showList(items, { title: '' });

      expect(consoleOutput[0]).toBe('');
      expect(consoleOutput[1]).toBe('└── file.txt');
    });
  });
});
