import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table, renderTable, TableColumn } from '../table.js';
import colors from 'ansi-colors';

// Mock console.log to capture output
let consoleOutput: string[] = [];
const originalLog = console.log;

beforeEach(() => {
  consoleOutput = [];
  console.log = vi.fn((message: string) => {
    consoleOutput.push(message);
  });
});

afterEach(() => {
  console.log = originalLog;
});

interface TestData {
  id: number;
  name: string;
  status: string;
  score: number;
}

describe('Table', () => {
  describe('basic rendering', () => {
    it('should render a simple table with headers and data', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
        { id: 2, name: 'Bob', status: 'inactive', score: 87 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 5 },
        { header: 'Name', key: 'name', width: 10 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Score', key: 'score', width: 8 },
      ];

      const table = new Table(columns);
      table.render(data);

      expect(consoleOutput.length).toBeGreaterThan(0);
      expect(consoleOutput[0]).toContain('ID');
      expect(consoleOutput[0]).toContain('Name');
      expect(consoleOutput[0]).toContain('Status');
      expect(consoleOutput[0]).toContain('Score');
    });

    it('should render empty table when data is empty', () => {
      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 5 },
        { header: 'Name', key: 'name', width: 10 },
      ];

      const table = new Table(columns);
      table.render([]);

      expect(consoleOutput.length).toBe(0);
    });

    it('should render table without header when showHeader is false', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 5 },
        { header: 'Name', key: 'name', width: 10 },
      ];

      const table = new Table(columns, { showHeader: false });
      table.render(data);

      expect(consoleOutput.length).toBe(1); // Only data row, no header or separator
      expect(consoleOutput[0]).toContain('1');
      expect(consoleOutput[0]).toContain('Alice');
    });

    it('should render table without separator when showSeparator is false', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 5 },
        { header: 'Name', key: 'name', width: 10 },
      ];

      const table = new Table(columns, { showSeparator: false });
      table.render(data);

      expect(consoleOutput.length).toBe(2); // Header and data row, no separator
      expect(consoleOutput[1]).toContain('1');
    });
  });

  describe('column width calculation', () => {
    it('should use fixed width when specified', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 10 },
      ];

      const table = new Table(columns);
      table.render(data);

      // The output should pad to width 10
      expect(consoleOutput[2]).toMatch(/1\s+/); // ID value with padding
    });

    it('should respect minWidth constraint', () => {
      const data: TestData[] = [
        { id: 1, name: 'Al', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'Name', key: 'name', minWidth: 15 },
      ];

      const table = new Table(columns);
      table.render(data);

      // Even though 'Al' is short, it should be padded to minWidth
      expect(consoleOutput[2].length).toBeGreaterThanOrEqual(15);
    });

    it('should respect maxWidth constraint', () => {
      const data: TestData[] = [
        {
          id: 1,
          name: 'A very long name that exceeds max',
          status: 'active',
          score: 95,
        },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'Name', key: 'name', maxWidth: 10, truncate: 'ellipsis' },
      ];

      const table = new Table(columns);
      table.render(data);

      // Name should be truncated with ellipsis
      expect(consoleOutput[2]).toContain('...');
    });
  });

  describe('text alignment', () => {
    it('should align text to the left by default', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'Name', key: 'name', width: 10 },
      ];

      const table = new Table(columns);
      table.render(data);

      // Left-aligned text should have trailing spaces
      expect(consoleOutput[2]).toMatch(/Alice\s+/);
    });

    it('should align text to the right when specified', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'Score', key: 'score', width: 10, align: 'right' },
      ];

      const table = new Table(columns);
      table.render(data);

      // Right-aligned should have leading spaces
      expect(consoleOutput[2]).toMatch(/\s+95/);
    });

    it('should align text to the center when specified', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 10, align: 'center' },
      ];

      const table = new Table(columns);
      table.render(data);

      // Center-aligned should have spaces on both sides
      expect(consoleOutput[2]).toMatch(/\s+1\s+/);
    });
  });

  describe('text truncation', () => {
    it('should truncate text with ellipsis when maxWidth is exceeded', () => {
      const data: TestData[] = [
        {
          id: 1,
          name: 'Very long name that will be truncated',
          status: 'active',
          score: 95,
        },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'Name', key: 'name', maxWidth: 15, truncate: 'ellipsis' },
      ];

      const table = new Table(columns);
      table.render(data);

      expect(consoleOutput[2]).toContain('...');
    });

    it('should truncate at word boundary when truncate is word', () => {
      const data: TestData[] = [
        { id: 1, name: 'Very long name here', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'Name', key: 'name', maxWidth: 15, truncate: 'word' },
      ];

      const table = new Table(columns);
      table.render(data);

      expect(consoleOutput[2]).toContain('...');
      // Should break at word boundary
      expect(consoleOutput[2]).not.toContain('Ver...');
    });

    it('should not truncate when text fits within maxWidth', () => {
      const data: TestData[] = [
        { id: 1, name: 'Short', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'Name', key: 'name', maxWidth: 15, truncate: 'ellipsis' },
      ];

      const table = new Table(columns);
      table.render(data);

      expect(consoleOutput[2]).toContain('Short');
      expect(consoleOutput[2]).not.toContain('...');
    });
  });

  describe('format function', () => {
    it('should apply format function to values', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'Score',
          key: 'score',
          width: 10,
          format: (value: number) => `${value}%`,
        },
      ];

      const table = new Table(columns);
      table.render(data);

      expect(consoleOutput[2]).toContain('95%');
    });

    it('should apply color formatting through format function', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'Status',
          key: 'status',
          width: 12,
          format: (value: string) => colors.green(value),
        },
      ];

      const table = new Table(columns);
      table.render(data);

      // Should contain ANSI color codes
      expect(consoleOutput[2]).toContain('\x1b[');
    });

    it('should pass both value and row to format function', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'Result',
          key: 'score',
          width: 15,
          format: (value: number, row: TestData) => `${row.name}: ${value}`,
        },
      ];

      const table = new Table(columns);
      table.render(data);

      expect(consoleOutput[2]).toContain('Alice: 95');
    });
  });

  describe('computed column values', () => {
    it('should support function-based column keys', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'Display',
          key: (row: TestData) => `${row.name} (${row.score})`,
          width: 20,
        },
      ];

      const table = new Table(columns);
      table.render(data);

      expect(consoleOutput[2]).toContain('Alice (95)');
    });

    it('should apply format function to computed values', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'Grade',
          key: (row: TestData) => (row.score >= 90 ? 'A' : 'B'),
          width: 8,
          format: (value: string) => colors.bold(value),
        },
      ];

      const table = new Table(columns);
      table.render(data);

      expect(consoleOutput[2]).toContain('A');
    });
  });

  describe('conditional column visibility', () => {
    it('should hide column when hide is true', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 5 },
        { header: 'Name', key: 'name', width: 10, hide: true },
        { header: 'Score', key: 'score', width: 8 },
      ];

      const table = new Table(columns);
      table.render(data);

      expect(consoleOutput[0]).toContain('ID');
      expect(consoleOutput[0]).not.toContain('Name');
      expect(consoleOutput[0]).toContain('Score');
    });

    it('should hide column conditionally based on row data', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 5 },
        {
          header: 'Name',
          key: 'name',
          width: 10,
          hide: (row: TestData) => row.score < 90,
        },
      ];

      const table = new Table(columns);
      table.render(data);

      // Name should be visible since score is >= 90
      expect(consoleOutput[0]).toContain('Name');
    });
  });

  describe('ANSI code handling', () => {
    it('should handle colored text without breaking alignment', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
        { id: 2, name: 'Bob', status: 'inactive', score: 87 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'ID',
          key: 'id',
          width: 5,
          format: (value: number) => colors.cyan(value.toString()),
        },
        { header: 'Name', key: 'name', width: 10 },
      ];

      const table = new Table(columns);
      table.render(data);

      // Both rows should exist
      expect(consoleOutput.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('renderTable convenience function', () => {
    it('should render table using convenience function', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 5 },
        { header: 'Name', key: 'name', width: 10 },
      ];

      renderTable(data, columns);

      expect(consoleOutput.length).toBeGreaterThan(0);
      expect(consoleOutput[0]).toContain('ID');
      expect(consoleOutput[0]).toContain('Name');
    });

    it('should accept options in convenience function', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 5 },
      ];

      renderTable(data, columns, { showHeader: false });

      expect(consoleOutput.length).toBe(1); // Only data row
    });
  });

  describe('custom separator character', () => {
    it('should use custom separator character', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 5 },
      ];

      const table = new Table(columns, { separatorChar: '=' });
      table.render(data);

      expect(consoleOutput[1]).toContain('=====');
    });
  });

  describe('header styling', () => {
    it('should apply custom header style', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 5 },
      ];

      const customStyle = (text: string) => colors.yellow(text);
      const table = new Table(columns, { headerStyle: customStyle });
      table.render(data);

      // Header should contain ANSI color codes for yellow
      expect(consoleOutput[0]).toContain('\x1b[');
    });
  });

  describe('truncation with formatting', () => {
    it('should preserve formatting when truncating with ellipsis', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice Johnson', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'Name',
          key: 'name',
          maxWidth: 8,
          truncate: 'ellipsis',
          format: (value: string) => colors.red(value),
        },
      ];

      const table = new Table(columns);
      table.render(data);

      const dataRow = consoleOutput[2];
      // Should contain ANSI color codes
      expect(dataRow).toContain('\x1b[');
      // Should be truncated
      expect(dataRow).toContain('...');
    });

    it('should preserve formatting when truncating with word mode', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice Johnson Smith', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'Name',
          key: 'name',
          maxWidth: 10,
          truncate: 'word',
          format: (value: string) => colors.green(value),
        },
      ];

      const table = new Table(columns);
      table.render(data);

      const dataRow = consoleOutput[2];
      // Should contain ANSI color codes
      expect(dataRow).toContain('\x1b[');
      // Should be truncated
      expect(dataRow).toContain('...');
    });

    it('should apply format to truncated text including ellipsis', () => {
      const data: TestData[] = [
        { id: 1, name: 'Very Long Name Here', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'Name',
          key: 'name',
          maxWidth: 10,
          truncate: 'ellipsis',
          format: (value: string) => colors.cyan(value),
        },
      ];

      const table = new Table(columns);
      table.render(data);

      const dataRow = consoleOutput[2];
      // The formatted string should include the ellipsis
      expect(dataRow).toContain('...');
      // And should have color codes
      expect(dataRow).toContain('\x1b[');
    });
  });

  describe('header width priority', () => {
    it('should prioritize header width over maxWidth when header is wider', () => {
      const data: TestData[] = [
        { id: 1, name: 'Al', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'Very Long Header Name',
          key: 'name',
          maxWidth: 5, // This is shorter than the header
        },
      ];

      const table = new Table(columns);
      table.render(data);

      // The header should not be truncated
      const headerRow = consoleOutput[0];
      expect(headerRow).toContain('Very Long Header Name');
      expect(headerRow).not.toContain('...');
    });

    it('should still apply maxWidth when content is wider than header', () => {
      const data: TestData[] = [
        { id: 1, name: 'Very long content here', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        {
          header: 'Name',
          key: 'name',
          maxWidth: 10,
          truncate: 'ellipsis',
        },
      ];

      const table = new Table(columns);
      table.render(data);

      // The content should be truncated
      const dataRow = consoleOutput[2];
      expect(dataRow).toContain('...');
    });
  });

  describe('column spacing', () => {
    it('should add default spacing of 1 between columns', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 2 },
        { header: 'Name', key: 'name', width: 5 },
      ];

      const table = new Table(columns);
      table.render(data);

      // Check that there's spacing between columns in the data row
      // ID is width 2, should be padded to 2 + 1 space + Name
      const dataRow = consoleOutput[2];
      expect(dataRow).toMatch(/1\s+Alice/);
    });

    it('should support custom column spacing', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 2 },
        { header: 'Name', key: 'name', width: 5 },
      ];

      const table = new Table(columns, { columnSpacing: 3 });
      table.render(data);

      // Check that there's 3 spaces between columns
      const dataRow = consoleOutput[2];
      // Should have ID (width 2) + 3 spaces + Name
      expect(dataRow).toContain('1    Alice'); // 1 + 1 space to fill width + 3 spacing
    });

    it('should not add spacing after the last column', () => {
      const data: TestData[] = [
        { id: 1, name: 'Alice', status: 'active', score: 95 },
      ];

      const columns: TableColumn<TestData>[] = [
        { header: 'ID', key: 'id', width: 2 },
        { header: 'Name', key: 'name', width: 5 },
      ];

      const table = new Table(columns, { columnSpacing: 2 });
      table.render(data);

      const dataRow = consoleOutput[2];
      // Name should not have extra spacing after it (should end with 'Alice' padded to 5)
      expect(dataRow.endsWith('Alice')).toBe(true);
    });
  });
});
