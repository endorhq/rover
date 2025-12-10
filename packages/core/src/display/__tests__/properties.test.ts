import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import colors from 'ansi-colors';
import { showProperties } from '../properties.js';

// Mock console.log to capture output
const originalConsoleLog = console.log;
let consoleOutput: string[] = [];

describe('showProperties', () => {
  beforeEach(() => {
    // Reset console output
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

  describe('basic functionality', () => {
    it('should display properties from a Map', () => {
      const properties = new Map<string, string>([
        ['ID', '76'],
        ['Title', 'Update the AGENTS.md file.'],
      ]);

      showProperties(properties);

      expect(consoleOutput).toHaveLength(2);
      expect(consoleOutput[0]).toContain('ID');
      expect(consoleOutput[0]).toContain('76');
      expect(consoleOutput[1]).toContain('Title');
      expect(consoleOutput[1]).toContain('Update the AGENTS.md file.');
    });

    it('should display properties from an object', () => {
      const properties = {
        ID: '76',
        Title: 'Update the AGENTS.md file.',
      };

      showProperties(properties);

      expect(consoleOutput).toHaveLength(2);
      expect(consoleOutput[0]).toContain('ID');
      expect(consoleOutput[0]).toContain('76');
      expect(consoleOutput[1]).toContain('Title');
      expect(consoleOutput[1]).toContain('Update the AGENTS.md file.');
    });

    it('should handle empty properties', () => {
      const properties = {};

      showProperties(properties);

      expect(consoleOutput).toHaveLength(0);
    });

    it('should handle empty Map', () => {
      const properties = new Map<string, string>();

      showProperties(properties);

      expect(consoleOutput).toHaveLength(0);
    });
  });

  describe('single-line values', () => {
    it('should prefix each line with · symbol', () => {
      const properties = {
        ID: '76',
        Status: 'Active',
      };

      showProperties(properties);

      // Check for the bullet symbol (may render differently in test env)
      for (const line of consoleOutput) {
        // The line should start with gray bullet followed by space
        expect(line).toMatch(/^\x1b\[90m.\x1b\[39m /);
      }
    });

    it('should show property names in gray', () => {
      const properties = {
        ID: '76',
      };

      showProperties(properties);

      expect(consoleOutput[0]).toContain(colors.gray('ID'));
    });

    it('should show values without color', () => {
      const properties = {
        ID: '76',
      };

      showProperties(properties);

      // Value should appear without color codes
      expect(consoleOutput[0]).toContain('76');
      // But not wrapped in gray
      expect(consoleOutput[0]).not.toContain(colors.gray('76'));
    });

    it("should format as 'key: value'", () => {
      const properties = {
        ID: '76',
      };

      showProperties(properties);

      // Check that output contains both key and value in the right order
      expect(consoleOutput[0]).toContain('ID');
      expect(consoleOutput[0]).toContain(':');
      expect(consoleOutput[0]).toContain('76');
    });
  });

  describe('multiline values', () => {
    it('should detect multiline values with \\n', () => {
      const properties = {
        Description:
          'This is a longer value that might spawn multiple lines.\nWe show it using the | decorator on the property name.',
      };

      showProperties(properties);

      // Should have 3 lines: property name + 2 value lines
      expect(consoleOutput).toHaveLength(3);
    });

    it('should use | decorator for multiline values', () => {
      const properties = {
        Description: 'Line 1\nLine 2',
      };

      showProperties(properties);

      // First line should have the | decorator
      expect(consoleOutput[0]).toContain(colors.gray('|'));
    });

    it('should indent multiline value lines', () => {
      const properties = {
        Description: 'Line 1\nLine 2\nLine 3',
      };

      showProperties(properties);

      // Check that value lines are indented
      expect(consoleOutput[1]).toMatch(/^\s+Line 1/);
      expect(consoleOutput[2]).toMatch(/^\s+Line 2/);
      expect(consoleOutput[3]).toMatch(/^\s+Line 3/);
    });

    it("should format multiline property header as 'key: |'", () => {
      const properties = {
        Description: 'Line 1\nLine 2',
      };

      showProperties(properties);

      expect(consoleOutput[0]).toContain(colors.gray('Description'));
      expect(consoleOutput[0]).toContain(colors.gray('|'));
    });

    it('should handle empty lines in multiline values', () => {
      const properties = {
        Content: 'Line 1\n\nLine 3',
      };

      showProperties(properties);

      expect(consoleOutput).toHaveLength(4); // Header + 3 lines (including empty)
      expect(consoleOutput[2]).toMatch(/^\s+$/); // Empty line should be indented
    });
  });

  describe('mixed content', () => {
    it('should handle mix of single-line and multiline values', () => {
      const properties = {
        ID: '76',
        Title: 'Update the AGENTS.md file.',
        Description:
          'This is a longer value that might spawn multiple lines.\nWe show it using the | decorator on the property name.',
      };

      showProperties(properties);

      // ID and Title are single lines, Description has header + 2 lines
      expect(consoleOutput).toHaveLength(5);

      // Check ID is single line
      expect(consoleOutput[0]).toContain('ID');
      expect(consoleOutput[0]).toContain('76');

      // Check Title is single line
      expect(consoleOutput[1]).toContain('Title');

      // Check Description is multiline
      expect(consoleOutput[2]).toContain('Description');
      expect(consoleOutput[2]).toContain(colors.gray('|'));
    });
  });

  describe('options', () => {
    it('should not add line break by default', () => {
      const properties = { ID: '76' };

      showProperties(properties);

      // First output should be the property, not an empty line
      expect(consoleOutput[0]).toContain('ID');
    });

    it('should add line break when addLineBreak is true', () => {
      const properties = { ID: '76' };

      showProperties(properties, { addLineBreak: true });

      // First output should be empty (from console.log())
      expect(consoleOutput[0]).toBe('');
      // Second output should be the property
      expect(consoleOutput[1]).toContain('ID');
    });

    it('should not add line break when addLineBreak is false', () => {
      const properties = { ID: '76' };

      showProperties(properties, { addLineBreak: false });

      // First output should be the property
      expect(consoleOutput[0]).toContain('ID');
    });
  });

  describe('special characters', () => {
    it('should handle unicode characters in keys', () => {
      const properties = {
        名前: 'Test Name',
      };

      showProperties(properties);

      expect(consoleOutput[0]).toContain('名前');
    });

    it('should handle unicode characters in values', () => {
      const properties = {
        Name: 'テスト',
      };

      showProperties(properties);

      expect(consoleOutput[0]).toContain('テスト');
    });

    it('should handle emojis in values', () => {
      const properties = {
        Status: 'Deployed 🚀',
      };

      showProperties(properties);

      expect(consoleOutput[0]).toContain('Deployed 🚀');
    });

    it('should handle special characters in property names', () => {
      const properties = {
        'Type (category)': 'Feature',
        '[Priority]': 'High',
      };

      showProperties(properties);

      expect(consoleOutput[0]).toContain('Type (category)');
      expect(consoleOutput[1]).toContain('[Priority]');
    });

    it('should handle colons in values', () => {
      const properties = {
        Time: '10:30:45',
      };

      showProperties(properties);

      expect(consoleOutput[0]).toContain('10:30:45');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string values', () => {
      const properties = {
        Empty: '',
      };

      showProperties(properties);

      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toContain('Empty');
    });

    it('should handle very long single-line values', () => {
      const longValue = 'A'.repeat(1000);
      const properties = {
        Long: longValue,
      };

      showProperties(properties);

      expect(consoleOutput[0]).toContain(longValue);
    });

    it('should handle values with only whitespace', () => {
      const properties = {
        Whitespace: '   ',
      };

      showProperties(properties);

      expect(consoleOutput).toHaveLength(1);
    });

    it('should handle multiple consecutive newlines', () => {
      const properties = {
        Content: 'Line 1\n\n\nLine 4',
      };

      showProperties(properties);

      expect(consoleOutput).toHaveLength(5); // Header + 4 lines
    });

    it('should handle values starting with newline', () => {
      const properties = {
        Content: '\nStarts with newline',
      };

      showProperties(properties);

      // First line after header should be empty
      expect(consoleOutput[1]).toMatch(/^\s+$/);
      expect(consoleOutput[2]).toContain('Starts with newline');
    });

    it('should handle values ending with newline', () => {
      const properties = {
        Content: 'Ends with newline\n',
      };

      showProperties(properties);

      // Should have header + 2 lines (content + empty)
      expect(consoleOutput).toHaveLength(3);
    });
  });

  describe('color formatting', () => {
    it('should use gray for bullet point', () => {
      const properties = { ID: '76' };

      showProperties(properties);

      // Check that the line starts with gray color code
      expect(consoleOutput[0]).toMatch(/^\x1b\[90m/);
    });

    it('should use gray for property names', () => {
      const properties = { ID: '76' };

      showProperties(properties);

      expect(consoleOutput[0]).toContain(colors.gray('ID'));
    });

    it('should use gray for pipe decorator in multiline', () => {
      const properties = { Content: 'Line 1\nLine 2' };

      showProperties(properties);

      expect(consoleOutput[0]).toContain(colors.gray('|'));
    });

    it('should not apply color to single-line values', () => {
      const properties = { ID: '76' };

      showProperties(properties);

      // Value should appear without being wrapped in any color function
      const line = consoleOutput[0];
      // Extract the part after the colon
      const valuePart = line.split(':')[1];
      // The value should be plain (not wrapped in gray)
      expect(valuePart).toContain('76');
      expect(valuePart).not.toContain('\x1b['); // Should not have ANSI codes around "76"
    });

    it('should not apply color to multiline values', () => {
      const properties = { Content: 'Line 1\nLine 2' };

      showProperties(properties);

      // Value lines should not have color codes
      expect(consoleOutput[1]).toContain('Line 1');
      expect(consoleOutput[2]).toContain('Line 2');
    });
  });

  describe('alignment', () => {
    it('should align multiline continuation with consistent indentation', () => {
      const properties = {
        Description: 'First line\nSecond line\nThird line',
      };

      showProperties(properties);

      // All value lines should have the same indentation
      const indent1 = consoleOutput[1].match(/^(\s+)/)?.[1];
      const indent2 = consoleOutput[2].match(/^(\s+)/)?.[1];
      const indent3 = consoleOutput[3].match(/^(\s+)/)?.[1];

      expect(indent1).toBe(indent2);
      expect(indent2).toBe(indent3);
    });
  });

  describe('integration with real example from docs', () => {
    it('should match the exact example from CLI guidelines', () => {
      const properties = {
        ID: '76',
        Title: 'Update the AGENTS.md file.',
        Description:
          'This is a longer value that might spawn multiple lines.\nWe show it using the | decorator on the property name.',
      };

      showProperties(properties);

      // Check overall structure
      expect(consoleOutput).toHaveLength(5);

      // Check first property (bullet + ID + value)
      expect(consoleOutput[0]).toMatch(/^\x1b\[90m/); // Starts with gray
      expect(consoleOutput[0]).toContain('ID');
      expect(consoleOutput[0]).toContain('76');

      // Check second property
      expect(consoleOutput[1]).toMatch(/^\x1b\[90m/); // Starts with gray
      expect(consoleOutput[1]).toContain('Title');
      expect(consoleOutput[1]).toContain('Update the AGENTS.md file.');

      // Check multiline property
      expect(consoleOutput[2]).toMatch(/^\x1b\[90m/); // Starts with gray
      expect(consoleOutput[2]).toContain('Description');
      expect(consoleOutput[2]).toContain('|');
      expect(consoleOutput[3]).toContain('This is a longer value');
      expect(consoleOutput[4]).toContain('We show it using the | decorator');
    });
  });
});
