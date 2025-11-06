import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showDiagram } from '../diagram.js';
import type { DiagramStep } from '../types.js';
import { stripAnsi } from '../utils.js';

// Mock console.log to capture output
const originalConsoleLog = console.log;
let consoleOutput: string[] = [];

describe('showDiagram', () => {
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

  describe('basic diagram rendering', () => {
    it('should render a single step diagram', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Context Analysis',
          items: ['• context.md'],
        },
      ];

      showDiagram(steps);

      // Should have a box but no arrow
      expect(consoleOutput.length).toBeGreaterThan(0);
      expect(consoleOutput.join('\n')).toContain('Context Analysis');
      expect(consoleOutput.join('\n')).toContain('• context.md');
      expect(consoleOutput.join('\n')).not.toContain('↓');
    });

    it('should render multiple steps with arrows between them', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Context Analysis',
          items: ['• context.md'],
        },
        {
          title: 'Outline',
          items: ['• outline.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Context Analysis');
      expect(output).toContain('Outline');
      expect(output).toContain('↓');
    });

    it('should render the example from the specification', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Context Analysis',
          items: ['• context.md'],
        },
        {
          title: 'Outline',
          items: ['• outline.md'],
        },
        {
          title: 'Draft',
          items: ['• draft.md'],
        },
        {
          title: 'Review',
          items: ['• docs.md', '• summary.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Context Analysis');
      expect(output).toContain('Outline');
      expect(output).toContain('Draft');
      expect(output).toContain('Review');
      expect(output).toContain('• context.md');
      expect(output).toContain('• outline.md');
      expect(output).toContain('• draft.md');
      expect(output).toContain('• docs.md');
      expect(output).toContain('• summary.md');

      // Should have 3 arrows (between 4 steps)
      const arrowCount = output.split('↓').length - 1;
      expect(arrowCount).toBe(3);
    });
  });

  describe('multiple items per step', () => {
    it('should render multiple items within a single step', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Review',
          items: ['• docs.md', '• summary.md', '• notes.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Review');
      expect(output).toContain('• docs.md');
      expect(output).toContain('• summary.md');
      expect(output).toContain('• notes.md');
    });

    it('should handle steps with varying numbers of items', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Step 1',
          items: ['• item1.md'],
        },
        {
          title: 'Step 2',
          items: ['• item2a.md', '• item2b.md', '• item2c.md'],
        },
        {
          title: 'Step 3',
          items: ['• item3a.md', '• item3b.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Step 1');
      expect(output).toContain('Step 2');
      expect(output).toContain('Step 3');
      expect(output).toContain('• item2a.md');
      expect(output).toContain('• item2b.md');
      expect(output).toContain('• item2c.md');
    });
  });

  describe('empty inputs', () => {
    it('should display nothing for an empty steps array', () => {
      showDiagram([]);

      expect(consoleOutput.length).toBe(0);
    });

    it('should handle steps with empty items array', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Empty Step',
          items: [],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Empty Step');
    });

    it('should handle multiple steps with some having empty items', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Step 1',
          items: ['• item.md'],
        },
        {
          title: 'Step 2',
          items: [],
        },
        {
          title: 'Step 3',
          items: ['• another.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Step 1');
      expect(output).toContain('Step 2');
      expect(output).toContain('Step 3');
    });
  });

  describe('addLineBreak option', () => {
    it('should add a line break before the diagram when addLineBreak is true', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Step',
          items: ['• item.md'],
        },
      ];

      showDiagram(steps, { addLineBreak: true });

      expect(consoleOutput[0]).toBe('');
    });

    it('should not add a line break when addLineBreak is false', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Step',
          items: ['• item.md'],
        },
      ];

      showDiagram(steps, { addLineBreak: false });

      expect(consoleOutput[0]).not.toBe('');
      expect(consoleOutput[0]).toContain('╭'); // Boxen uses rounded corners
    });

    it('should not add a line break when addLineBreak is not provided', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Step',
          items: ['• item.md'],
        },
      ];

      showDiagram(steps);

      expect(consoleOutput[0]).not.toBe('');
      expect(consoleOutput[0]).toContain('╭'); // Boxen uses rounded corners
    });
  });

  describe('arrow placement', () => {
    it('should not add an arrow after the last step', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Step 1',
          items: ['• item1.md'],
        },
        {
          title: 'Step 2',
          items: ['• item2.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      const lines = output.split('\n');

      // Find the last line with content
      const lastNonEmptyLine = lines
        .slice()
        .reverse()
        .find(line => line.trim() !== '');

      // The last non-empty line should not be an arrow
      expect(lastNonEmptyLine).not.toContain('↓');
    });

    it('should add arrows between all steps except after the last one', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Step 1',
          items: ['• item1.md'],
        },
        {
          title: 'Step 2',
          items: ['• item2.md'],
        },
        {
          title: 'Step 3',
          items: ['• item3.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      const arrowCount = output.split('↓').length - 1;

      // Should have 2 arrows (between 3 steps)
      expect(arrowCount).toBe(2);
    });
  });

  describe('special characters and unicode', () => {
    it('should handle titles with special characters', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Context Analysis & Review',
          items: ['• item.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Context Analysis & Review');
    });

    it('should handle items with unicode characters', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Files',
          items: ['• 文件.md', '• файл.md', '• 📄 document.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('• 文件.md');
      expect(output).toContain('• файл.md');
      expect(output).toContain('• 📄 document.md');
    });

    it('should handle emojis in titles', () => {
      const steps: DiagramStep[] = [
        {
          title: '🚀 Deployment',
          items: ['• deploy.sh'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('🚀 Deployment');
    });
  });

  describe('long titles and items', () => {
    it('should handle very long titles', () => {
      const longTitle = 'A very long title that spans many characters';
      const steps: DiagramStep[] = [
        {
          title: longTitle,
          items: ['• item.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain(longTitle);
    });

    it('should handle very long item names', () => {
      const longItem = '• a'.repeat(100) + '.md';
      const steps: DiagramStep[] = [
        {
          title: 'Files',
          items: [longItem],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      // Long items will be wrapped by boxen, so just check it appears somewhere
      expect(output).toContain('Files');
      expect(output).toContain('.md');
    });

    it('should handle multiple long items', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Long Files',
          items: [
            '• src/components/features/authentication/LoginForm.tsx',
            '• src/components/features/authentication/RegisterForm.tsx',
            '• src/components/features/authentication/PasswordResetForm.tsx',
          ],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('LoginForm.tsx');
      expect(output).toContain('RegisterForm.tsx');
      expect(output).toContain('PasswordResetForm.tsx');
    });
  });

  describe('items without bullet points', () => {
    it('should handle items that do not have bullet points', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Plain Items',
          items: ['context.md', 'outline.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('context.md');
      expect(output).toContain('outline.md');
    });

    it('should handle mix of items with and without bullet points', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Mixed',
          items: ['• with-bullet.md', 'without-bullet.md', '• another-with.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('• with-bullet.md');
      expect(output).toContain('without-bullet.md');
      expect(output).toContain('• another-with.md');
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings as items', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Empty Items',
          items: ['', '• item.md', ''],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Empty Items');
      expect(output).toContain('• item.md');
    });

    it('should handle items that are only whitespace', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Whitespace',
          items: ['   ', '• item.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Whitespace');
      expect(output).toContain('• item.md');
    });

    it('should handle title that is an empty string', () => {
      const steps: DiagramStep[] = [
        {
          title: '',
          items: ['• item.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('• item.md');
    });
  });

  describe('maxWidth option', () => {
    it('should use uniform width across all boxes based on largest content', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Short',
          items: ['• a.md'],
        },
        {
          title: 'Very Long Title That Should Define Width',
          items: ['• b.md'],
        },
        {
          title: 'Short Again',
          items: ['• c.md'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      const lines = output.split('\n');

      // Find all box top lines
      const topLines = lines.filter(line => line.includes('╭'));

      // All boxes should have the same width
      const widths = topLines.map(line => stripAnsi(line).length);
      expect(widths.every(w => w === widths[0])).toBe(true);
    });

    it('should respect custom maxWidth option', () => {
      const steps: DiagramStep[] = [
        {
          title: 'A very long title that would normally make a wide box',
          items: ['• item.md'],
        },
      ];

      showDiagram(steps, { maxWidth: 30 });

      const output = consoleOutput.join('\n');
      const lines = output.split('\n');
      const topLine = lines.find(line => line.includes('╭'));

      expect(topLine).toBeDefined();
      expect(stripAnsi(topLine!).length).toBeLessThanOrEqual(30);
    });

    it('should use calculated width when smaller than maxWidth', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Short',
          items: ['• item.md'],
        },
      ];

      showDiagram(steps, { maxWidth: 100 });

      const output = consoleOutput.join('\n');
      const lines = output.split('\n');
      const topLine = lines.find(line => line.includes('╭'));

      expect(topLine).toBeDefined();
      // Width should be much smaller than maxWidth
      expect(stripAnsi(topLine!).length).toBeLessThan(100);
    });

    it('should default to 80 when maxWidth is not provided', () => {
      const veryLongItem = '• ' + 'a'.repeat(200) + '.md';
      const steps: DiagramStep[] = [
        {
          title: 'Files',
          items: [veryLongItem],
        },
      ];

      showDiagram(steps); // No maxWidth specified

      const output = consoleOutput.join('\n');
      const lines = output.split('\n');
      const topLine = lines.find(line => line.includes('╭'));

      expect(topLine).toBeDefined();
      // Should be capped at default 80
      expect(stripAnsi(topLine!).length).toBe(80);
    });
  });

  describe('integration scenarios', () => {
    it('should render a typical workflow diagram', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Planning',
          items: ['• requirements.md', '• architecture.md'],
        },
        {
          title: 'Development',
          items: ['• src/index.ts', '• src/utils.ts', '• src/types.ts'],
        },
        {
          title: 'Testing',
          items: ['• tests/unit.test.ts', '• tests/integration.test.ts'],
        },
        {
          title: 'Deployment',
          items: ['• build.sh', '• deploy.sh'],
        },
      ];

      showDiagram(steps);

      const output = consoleOutput.join('\n');
      expect(output).toContain('Planning');
      expect(output).toContain('Development');
      expect(output).toContain('Testing');
      expect(output).toContain('Deployment');

      // Should have 3 arrows
      const arrowCount = output.split('↓').length - 1;
      expect(arrowCount).toBe(3);
    });

    it('should work with all options combined', () => {
      const steps: DiagramStep[] = [
        {
          title: 'Step 1',
          items: ['• item1.md'],
        },
        {
          title: 'Step 2',
          items: ['• item2.md'],
        },
      ];

      showDiagram(steps, { addLineBreak: true });

      expect(consoleOutput[0]).toBe('');
      const output = consoleOutput.join('\n');
      expect(output).toContain('Step 1');
      expect(output).toContain('Step 2');
      expect(output).toContain('↓');
    });
  });
});
