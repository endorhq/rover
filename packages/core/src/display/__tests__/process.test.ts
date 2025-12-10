import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import colors from 'ansi-colors';

// Mock log-update - must be hoisted before imports
vi.mock('log-update', () => {
  const mockLogUpdate = Object.assign(vi.fn(), {
    persist: vi.fn(),
    clear: vi.fn(),
    done: vi.fn(),
  });

  return {
    default: mockLogUpdate,
  };
});

// Import after mocks are set up
import { ProcessManager } from '../process.js';
import logUpdate from 'log-update';

// Get references to mocked functions
const mockLogUpdate = logUpdate as unknown as ReturnType<typeof vi.fn> & {
  persist: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  done: ReturnType<typeof vi.fn>;
};
const mockPersist = mockLogUpdate.persist;
const mockClear = mockLogUpdate.clear;
const mockDone = mockLogUpdate.done;

// Mock console.log to capture title output
const originalConsoleLog = console.log;
let consoleOutput: string[] = [];

describe('ProcessManager', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
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

  describe('constructor', () => {
    it('should create a ProcessManager with required options', () => {
      const process = new ProcessManager({ title: 'Test Process' });
      expect(process).toBeInstanceOf(ProcessManager);
    });

    it('should use default showTimestamp option as true', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.start();
      process.addItem('Test item');

      const renderedOutput = mockLogUpdate.mock.calls[0][0];
      expect(renderedOutput).toMatch(/\d{2}:\d{2}/); // Should contain timestamp
    });

    it('should allow disabling timestamps', () => {
      const process = new ProcessManager({
        title: 'Test',
        showTimestamp: false,
      });
      process.start();
      process.addItem('Test item');

      const renderedOutput = mockLogUpdate.mock.calls[0][0];
      expect(renderedOutput).not.toMatch(/\d{2}:\d{2}/); // Should not contain timestamp
    });
  });

  describe('start', () => {
    it('should display the title when started', () => {
      const process = new ProcessManager({ title: 'Deploy Application' });
      process.start();

      // Check that console.log was called with title and separator
      expect(consoleOutput.length).toBeGreaterThan(0);
      expect(consoleOutput.join('\n')).toContain('Deploy Application');
    });

    it('should not display title multiple times if started twice', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.start();
      const firstCallCount = consoleOutput.length;
      process.start();

      expect(consoleOutput.length).toBe(firstCallCount);
    });

    it('should auto-start when adding first item', () => {
      const process = new ProcessManager({ title: 'Auto Start Test' });
      process.addItem('First item');

      expect(consoleOutput.join('\n')).toContain('Auto Start Test');
    });
  });

  describe('addItem', () => {
    it('should add an item with in_progress status', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Creating deployment');

      expect(mockLogUpdate).toHaveBeenCalled();
      const renderedOutput = mockLogUpdate.mock.calls[0][0];
      expect(renderedOutput).toContain('Creating deployment');
      expect(renderedOutput).toContain(colors.cyan('◐')); // in_progress icon
    });

    it('should include timestamp when showTimestamp is true', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Test item');

      const renderedOutput = mockLogUpdate.mock.calls[0][0];
      expect(renderedOutput).toMatch(/\d{2}:\d{2}/);
      expect(renderedOutput).toContain(colors.gray('|'));
    });

    it('should not include timestamp when showTimestamp is false', () => {
      const process = new ProcessManager({
        title: 'Test',
        showTimestamp: false,
      });
      process.addItem('Test item');

      const renderedOutput = mockLogUpdate.mock.calls[0][0];
      expect(renderedOutput).not.toMatch(/\d{2}:\d{2}/);
    });

    it('should auto-start the process if not started', () => {
      const process = new ProcessManager({ title: 'Auto Start' });
      process.addItem('First item');

      expect(consoleOutput.length).toBeGreaterThan(0);
    });
  });

  describe('updateLastItem', () => {
    it('should update the message of the last item', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Downloading');
      vi.clearAllMocks();

      process.updateLastItem('Downloading (50%)');

      expect(mockLogUpdate).toHaveBeenCalled();
      const renderedOutput = mockLogUpdate.mock.calls[0][0];
      expect(renderedOutput).toContain('Downloading (50%)');
    });

    it('should keep the in_progress status', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Processing');
      process.updateLastItem('Processing - step 2');

      const renderedOutput = mockLogUpdate.mock.calls[1][0];
      expect(renderedOutput).toContain(colors.cyan('◐')); // Should still be cyan
    });

    it('should throw error if no items exist', () => {
      const process = new ProcessManager({ title: 'Test' });

      expect(() => process.updateLastItem('Update')).toThrow(
        'No items in process to update'
      );
    });

    it('should allow multiple updates to the same item', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Upload');
      process.updateLastItem('Upload (25%)');
      process.updateLastItem('Upload (50%)');
      process.updateLastItem('Upload (75%)');

      expect(mockLogUpdate).toHaveBeenCalledTimes(4); // 1 add + 3 updates
      const lastCall = mockLogUpdate.mock.calls[3][0];
      expect(lastCall).toContain('Upload (75%)');
    });
  });

  describe('completeLastItem', () => {
    it('should mark the last item as completed', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Creating branch');
      process.completeLastItem();

      expect(mockPersist).toHaveBeenCalled();
      const persistedOutput = mockPersist.mock.calls[0][0];
      expect(persistedOutput).toContain(colors.green('●')); // completed icon
      expect(mockClear).toHaveBeenCalled();
    });

    it('should persist the completed item to terminal', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Build project');
      process.completeLastItem();

      expect(mockPersist).toHaveBeenCalledTimes(1);
      expect(mockClear).toHaveBeenCalledTimes(1);
    });

    it('should throw error if no items exist', () => {
      const process = new ProcessManager({ title: 'Test' });

      expect(() => process.completeLastItem()).toThrow(
        'No items in process to update'
      );
    });

    it('should preserve the original message', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Deploy to production');
      process.completeLastItem();

      const persistedOutput = mockPersist.mock.calls[0][0];
      expect(persistedOutput).toContain('Deploy to production');
    });
  });

  describe('failLastItem', () => {
    it('should mark the last item as failed', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Starting container');
      process.failLastItem();

      expect(mockPersist).toHaveBeenCalled();
      const persistedOutput = mockPersist.mock.calls[0][0];
      expect(persistedOutput).toContain(colors.red('●')); // failed icon
    });

    it('should replace message with error message if provided', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Connecting to database');
      process.failLastItem('Connection timeout');

      const persistedOutput = mockPersist.mock.calls[0][0];
      expect(persistedOutput).toContain('Connection timeout');
      expect(persistedOutput).not.toContain('Connecting to database');
    });

    it('should keep original message if no error message provided', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Running tests');
      process.failLastItem();

      const persistedOutput = mockPersist.mock.calls[0][0];
      expect(persistedOutput).toContain('Running tests');
    });

    it('should throw error if no items exist', () => {
      const process = new ProcessManager({ title: 'Test' });

      expect(() => process.failLastItem()).toThrow(
        'No items in process to update'
      );
    });
  });

  describe('nextItem', () => {
    it('should complete last item and add new one', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('First step');
      vi.clearAllMocks();

      process.nextItem('Second step');

      expect(mockPersist).toHaveBeenCalledTimes(1); // Completed first
      expect(mockLogUpdate).toHaveBeenCalledTimes(1); // Added second
      const newItemOutput = mockLogUpdate.mock.calls[0][0];
      expect(newItemOutput).toContain('Second step');
    });

    it('should just add item if no previous items exist', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.nextItem('First step');

      expect(mockPersist).not.toHaveBeenCalled();
      expect(mockLogUpdate).toHaveBeenCalled();
    });

    it('should allow chaining multiple steps', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.nextItem('Step 1');
      process.nextItem('Step 2');
      process.nextItem('Step 3');

      expect(mockPersist).toHaveBeenCalledTimes(2); // Step 1 and 2 completed
      expect(mockLogUpdate).toHaveBeenCalledTimes(3); // All 3 added
    });
  });

  describe('finish', () => {
    it('should persist all output using logUpdate.done()', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Final step');
      process.completeLastItem();
      process.finish();

      expect(mockDone).toHaveBeenCalled();
    });

    it('should be safe to call multiple times', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.finish();
      process.finish();

      expect(mockDone).toHaveBeenCalledTimes(2);
    });
  });

  describe('status icons', () => {
    it('should use cyan icon for in_progress status', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('In progress item');

      const output = mockLogUpdate.mock.calls[0][0];
      expect(output).toContain(colors.cyan('◐'));
    });

    it('should use green icon for completed status', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Completed item');
      process.completeLastItem();

      const output = mockPersist.mock.calls[0][0];
      expect(output).toContain(colors.green('●'));
    });

    it('should use red icon for failed status', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Failed item');
      process.failLastItem();

      const output = mockPersist.mock.calls[0][0];
      expect(output).toContain(colors.red('●'));
    });
  });

  describe('integration scenarios', () => {
    it('should handle a complete deployment workflow', () => {
      const process = new ProcessManager({
        title: 'Deploy to Production',
      });

      // Step 1: Build
      process.addItem('Building application');
      process.updateLastItem('Building application (compiling...)');
      process.updateLastItem('Building application (bundling...)');
      process.completeLastItem();

      // Step 2: Tests
      process.addItem('Running tests');
      process.completeLastItem();

      // Step 3: Upload (with progress)
      process.addItem('Uploading artifacts');
      process.updateLastItem('Uploading artifacts (1/3)');
      process.updateLastItem('Uploading artifacts (2/3)');
      process.updateLastItem('Uploading artifacts (3/3)');
      process.completeLastItem();

      // Step 4: Deploy
      process.addItem('Deploying to server');
      process.completeLastItem();

      process.finish();

      // Verify sequence of calls
      expect(mockPersist).toHaveBeenCalledTimes(4); // 4 completed items
      expect(mockDone).toHaveBeenCalledTimes(1);
    });

    it('should handle a workflow with failure', () => {
      const process = new ProcessManager({ title: 'Build Project' });

      process.addItem('Installing dependencies');
      process.completeLastItem();

      process.addItem('Compiling TypeScript');
      process.failLastItem('Type errors found');

      process.finish();

      expect(mockPersist).toHaveBeenCalledTimes(2);
      const failedOutput = mockPersist.mock.calls[1][0];
      expect(failedOutput).toContain(colors.red('●'));
      expect(failedOutput).toContain('Type errors found');
    });

    it('should handle rapid updates correctly', () => {
      const process = new ProcessManager({ title: 'Fast Updates' });

      process.addItem('Processing');
      for (let i = 0; i <= 100; i += 10) {
        process.updateLastItem(`Processing (${i}%)`);
      }
      process.completeLastItem();

      expect(mockLogUpdate).toHaveBeenCalled();
      expect(mockPersist).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty messages', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('');

      expect(mockLogUpdate).toHaveBeenCalled();
      const output = mockLogUpdate.mock.calls[0][0];
      expect(output).toBeTruthy();
    });

    it('should handle very long messages', () => {
      const process = new ProcessManager({ title: 'Test' });
      const longMessage = 'A'.repeat(1000);
      process.addItem(longMessage);

      const output = mockLogUpdate.mock.calls[0][0];
      expect(output).toContain(longMessage);
    });

    it('should handle unicode characters in messages', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Deploying 🚀 to production');
      process.completeLastItem();

      const output = mockPersist.mock.calls[0][0];
      expect(output).toContain('Deploying 🚀 to production');
    });

    it('should handle special characters in title', () => {
      const process = new ProcessManager({
        title: 'Deploy [env: prod] (v1.2.3)',
      });
      process.start();

      expect(consoleOutput.join('\n')).toContain('Deploy [env: prod] (v1.2.3)');
    });
  });

  describe('timestamp formatting', () => {
    it('should format timestamps as HH:MM', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Test item');

      const output = mockLogUpdate.mock.calls[0][0];
      expect(output).toMatch(/\d{2}:\d{2}/);
    });

    it('should use gray color for timestamps', () => {
      const process = new ProcessManager({ title: 'Test' });
      process.addItem('Test item');

      const output = mockLogUpdate.mock.calls[0][0];
      // Timestamp should be wrapped in gray color
      expect(output).toContain(colors.gray('|'));
    });
  });
});
