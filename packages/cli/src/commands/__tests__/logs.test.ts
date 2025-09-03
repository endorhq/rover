import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchSync } from 'rover-common';
import { logsCommand } from '../logs.js';
import { TaskDescription } from '../../lib/description.js';

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventLogs: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock enquirer (not used in logs but imported indirectly)
vi.mock('enquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

// Mock exit utilities to prevent process.exit
vi.mock('../../utils/exit.js', () => ({
  exitWithError: vi.fn().mockImplementation(() => {}),
  exitWithSuccess: vi.fn().mockImplementation(() => {}),
  exitWithWarn: vi.fn().mockImplementation(() => {}),
}));

// Mock display utilities to suppress output
vi.mock('../../utils/display.js', () => ({
  showRoverChat: vi.fn(),
  showTips: vi.fn(),
  TIP_TITLES: {},
}));

// Mock the OS utilities for Docker commands
vi.mock('rover-common', async () => {
  const actual = await vi.importActual('rover-common');
  return {
    ...actual,
    launchSync: vi.fn(),
    launch: vi.fn(),
  };
});

describe('logs command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Create temp directory with git repo
    testDir = mkdtempSync(join(tmpdir(), 'rover-logs-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Get the real launchSync for Git operations
    const { launchSync: realLaunchSync } = (await vi.importActual(
      'rover-common'
    )) as any;

    // Initialize git repo
    realLaunchSync('git', ['init']);
    realLaunchSync('git', ['config', 'user.email', 'test@test.com']);
    realLaunchSync('git', ['config', 'user.name', 'Test User']);
    realLaunchSync('git', ['config', 'commit.gpgsign', 'false']);

    // Create initial commit
    writeFileSync('README.md', '# Test');
    realLaunchSync('git', ['add', '.']);
    realLaunchSync('git', ['commit', '-m', 'Initial commit']);

    // Create .rover directory structure
    mkdirSync('.rover/tasks', { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // Helper to create a test task with container ID
  const createTestTaskWithContainer = async (
    id: number,
    title: string = 'Test Task',
    containerId?: string
  ) => {
    const task = TaskDescription.create({
      id,
      title,
      description: 'Test task description',
    });

    // Create a git worktree for the task
    const worktreePath = join('.rover', 'tasks', id.toString(), 'workspace');
    const branchName = `rover-task-${id}`;

    // Get the real launchSync for Git operations
    const { launchSync: realLaunchSync } = (await vi.importActual(
      'rover-common'
    )) as any;
    realLaunchSync('git', ['worktree', 'add', worktreePath, '-b', branchName]);
    task.setWorkspace(join(testDir, worktreePath), branchName);

    // Set container ID if provided
    if (containerId) {
      task.setContainerInfo(containerId, 'running');
    }

    return task;
  };

  // Helper to create iterations directory structure
  const createIterations = (taskId: number, iterations: number[]) => {
    const taskPath = join('.rover', 'tasks', taskId.toString());
    for (const iter of iterations) {
      const iterPath = join(taskPath, 'iterations', iter.toString());
      mkdirSync(iterPath, { recursive: true });
      writeFileSync(join(iterPath, 'context.md'), `# Context ${iter}`);
      writeFileSync(join(iterPath, 'plan.md'), `# Plan ${iter}`);
    }
  };

  describe('Task ID validation', () => {
    it('should reject non-numeric task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('invalid');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid task ID 'invalid' - must be a number",
        }),
        false
      );
    });

    it('should reject empty task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid task ID '' - must be a number",
        }),
        false
      );
    });

    it('should handle floating point task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('1.5');

      // parseInt('1.5') = 1, so this should try to load task 1
      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'The task with ID 1 was not found',
        }),
        false
      );
    });
  });

  describe('Task not found scenarios', () => {
    it('should handle non-existent task gracefully', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('999');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'The task with ID 999 was not found',
        }),
        false
      );
    });

    it('should handle negative task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('-1');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'The task with ID -1 was not found',
        }),
        false
      );
    });
  });

  describe('Iteration validation', () => {
    it('should reject non-numeric iteration number', async () => {
      await createTestTaskWithContainer(1, 'Test Task', 'container123');
      createIterations(1, [1, 2]);

      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('1', 'invalid');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid iteration number: 'invalid'",
        }),
        false
      );
    });

    it('should handle non-existent iteration', async () => {
      await createTestTaskWithContainer(2, 'Test Task', 'container123');
      createIterations(2, [1, 2]);

      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('2', '5');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error:
            "Iteration 5 not found for task '2'. Available iterations: 1, 2",
        }),
        false
      );
    });
  });

  describe('No iterations scenarios', () => {
    it('should warn when no iterations found', async () => {
      await createTestTaskWithContainer(
        3,
        'No Iterations Task',
        'container123'
      );

      const { exitWithWarn } = await import('../../utils/exit.js');

      await logsCommand('3');

      expect(exitWithWarn).toHaveBeenCalledWith(
        "No iterations found for task '3'",
        expect.objectContaining({
          logs: '',
          success: false,
        }),
        false
      );
    });

    it('should warn when no iterations found in JSON mode', async () => {
      await createTestTaskWithContainer(
        4,
        'No Iterations Task',
        'container123'
      );

      const { exitWithWarn } = await import('../../utils/exit.js');

      await logsCommand('4', undefined, { json: true });

      expect(exitWithWarn).toHaveBeenCalledWith(
        "No iterations found for task '4'",
        expect.objectContaining({
          logs: '',
          success: false,
        }),
        true
      );
    });
  });

  describe('No container scenarios', () => {
    it('should warn when no container found', async () => {
      await createTestTaskWithContainer(5, 'No Container Task'); // No container ID provided
      createIterations(5, [1]);

      const { exitWithWarn } = await import('../../utils/exit.js');

      await logsCommand('5');

      expect(exitWithWarn).toHaveBeenCalledWith(
        "No container found for task '5'. Logs are only available for recent tasks",
        expect.objectContaining({
          logs: '',
          success: false,
        }),
        false
      );
    });

    it('should warn when no container found in JSON mode', async () => {
      await createTestTaskWithContainer(6, 'No Container Task'); // No container ID provided
      createIterations(6, [1]);

      const { exitWithWarn } = await import('../../utils/exit.js');

      await logsCommand('6', undefined, { json: true });

      expect(exitWithWarn).toHaveBeenCalledWith(
        "No container found for task '6'. Logs are only available for recent tasks",
        expect.objectContaining({
          logs: '',
          success: false,
        }),
        true
      );
    });
  });

  describe('Docker logs retrieval', () => {
    it('should successfully retrieve and display logs', async () => {
      await createTestTaskWithContainer(7, 'Success Task', 'container123');
      createIterations(7, [1, 2]);

      const { launchSync } = await import('rover-common');
      vi.mocked(launchSync).mockReturnValue({
        stdout: 'Log line 1\nLog line 2\nLog line 3',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('7');

      expect(launchSync).toHaveBeenCalledWith('docker', [
        'logs',
        'container123',
      ]);
    });

    it('should print logs to console output', async () => {
      await createTestTaskWithContainer(
        21,
        'Console Output Task',
        'console123'
      );
      createIterations(21, [1]);

      const { launchSync } = await import('rover-common');

      // Mock console.log to capture output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const testLogs =
        'Starting application...\nProcessing data...\nTask completed successfully!\n\nFinal status: OK';

      vi.mocked(launchSync).mockReturnValue({
        stdout: testLogs,
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('21');

      // Verify header information is printed
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task 21 Logs')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Console Output Task')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Iteration:')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Execution Log')
      );

      // Verify each log line is printed
      expect(consoleSpy).toHaveBeenCalledWith('Starting application...');
      expect(consoleSpy).toHaveBeenCalledWith('Processing data...');
      expect(consoleSpy).toHaveBeenCalledWith('Task completed successfully!');
      expect(consoleSpy).toHaveBeenCalledWith(''); // Empty line
      expect(consoleSpy).toHaveBeenCalledWith('Final status: OK');

      consoleSpy.mockRestore();
    });

    it('should print logs with special characters and formatting', async () => {
      await createTestTaskWithContainer(22, 'Special Chars Task', 'special123');
      createIterations(22, [1]);

      const { launchSync } = await import('rover-common');

      // Mock console.log to capture output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const testLogs =
        '[ERROR] Failed to connect\n→ Retrying...\n✓ Connected!\n{ "status": "ok" }\nTab\there';

      vi.mocked(launchSync).mockReturnValue({
        stdout: testLogs,
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('22');

      // Verify special characters are preserved
      expect(consoleSpy).toHaveBeenCalledWith('[ERROR] Failed to connect');
      expect(consoleSpy).toHaveBeenCalledWith('→ Retrying...');
      expect(consoleSpy).toHaveBeenCalledWith('✓ Connected!');
      expect(consoleSpy).toHaveBeenCalledWith('{ "status": "ok" }');
      expect(consoleSpy).toHaveBeenCalledWith('Tab\there');

      consoleSpy.mockRestore();
    });

    it('should handle multiline logs with proper formatting', async () => {
      await createTestTaskWithContainer(23, 'Multiline Task', 'multiline123');
      createIterations(23, [1]);

      const { launchSync } = await import('rover-common');

      // Mock console.log to capture output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const testLogs = `Line 1
Line 2

Line 4 (after empty line)


Line 7 (after two empty lines)
Last line`;

      vi.mocked(launchSync).mockReturnValue({
        stdout: testLogs,
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('23');

      // Verify empty lines are preserved
      const logCalls = consoleSpy.mock.calls.map(call => call[0]);

      // Find the index where actual logs start (after headers)
      const line1Index = logCalls.findIndex(line => line === 'Line 1');

      expect(logCalls[line1Index]).toBe('Line 1');
      expect(logCalls[line1Index + 1]).toBe('Line 2');
      expect(logCalls[line1Index + 2]).toBe(''); // Empty line
      expect(logCalls[line1Index + 3]).toBe('Line 4 (after empty line)');
      expect(logCalls[line1Index + 4]).toBe(''); // Empty line
      expect(logCalls[line1Index + 5]).toBe(''); // Empty line
      expect(logCalls[line1Index + 6]).toBe('Line 7 (after two empty lines)');
      expect(logCalls[line1Index + 7]).toBe('Last line');

      consoleSpy.mockRestore();
    });

    it('should return logs in JSON format', async () => {
      await createTestTaskWithContainer(8, 'JSON Task', 'container456');
      createIterations(8, [1]);

      const { launchSync } = await import('rover-common');
      vi.mocked(launchSync).mockReturnValue({
        stdout: 'JSON log output\nAnother line',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('8', undefined, { json: true });

      expect(launchSync).toHaveBeenCalledWith('docker', [
        'logs',
        'container456',
      ]);
    });

    it('should handle empty logs', async () => {
      await createTestTaskWithContainer(9, 'Empty Logs Task', 'container789');
      createIterations(9, [1]);

      const { launchSync } = await import('rover-common');
      const { exitWithWarn } = await import('../../utils/exit.js');

      vi.mocked(launchSync).mockReturnValue({
        stdout: '   \n   \n   ', // Just whitespace
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('9');

      expect(exitWithWarn).toHaveBeenCalledWith(
        'No logs available for this container. Logs are only available for recent tasks',
        expect.objectContaining({
          logs: '',
          success: false,
        }),
        false
      );
    });
  });

  describe('Docker error scenarios', () => {
    it('should handle "No such container" error', async () => {
      await createTestTaskWithContainer(
        10,
        'Missing Container Task',
        'nonexistent123'
      );
      createIterations(10, [1]);

      const { launchSync } = await import('rover-common');
      const { exitWithWarn } = await import('../../utils/exit.js');

      vi.mocked(launchSync).mockImplementation(() => {
        throw new Error('No such container: nonexistent123');
      });

      await logsCommand('10');

      expect(exitWithWarn).toHaveBeenCalledWith(
        'No logs available for this container. Logs are only available for recent tasks',
        expect.objectContaining({
          logs: '',
          success: false,
        }),
        false
      );
    });

    it('should handle general Docker errors', async () => {
      await createTestTaskWithContainer(11, 'Docker Error Task', 'error123');
      createIterations(11, [1]);

      const { launchSync } = await import('rover-common');
      const { exitWithError } = await import('../../utils/exit.js');

      vi.mocked(launchSync).mockImplementation(() => {
        throw new Error('Docker daemon not running');
      });

      await logsCommand('11');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Error retrieving container logs: Docker daemon not running',
        }),
        false
      );
    });

    it('should handle Docker permission errors', async () => {
      await createTestTaskWithContainer(12, 'Permission Error Task', 'perm123');
      createIterations(12, [1]);

      const { launchSync } = await import('rover-common');
      const { exitWithError } = await import('../../utils/exit.js');

      vi.mocked(launchSync).mockImplementation(() => {
        throw new Error(
          'permission denied while trying to connect to the Docker daemon socket'
        );
      });

      await logsCommand('12');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error:
            'Error retrieving container logs: permission denied while trying to connect to the Docker daemon socket',
        }),
        false
      );
    });
  });

  describe('Follow mode', () => {
    it('should start follow mode with valid container', async () => {
      await createTestTaskWithContainer(13, 'Follow Task', 'follow123');
      createIterations(13, [1]);

      const { launch } = await import('rover-common');
      vi.mocked(launch).mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        failed: false,
        timedOut: false,
        isCanceled: false,
        killed: false,
      } as any);

      await logsCommand('13', undefined, { follow: true });

      expect(launch).toHaveBeenCalledWith(
        'docker',
        ['logs', '-f', 'follow123'],
        expect.objectContaining({
          stdout: ['inherit'],
          stderr: ['inherit'],
          cancelSignal: expect.any(AbortSignal),
        })
      );
    });

    it('should stream logs in follow mode with inherit stdio', async () => {
      await createTestTaskWithContainer(24, 'Stream Task', 'stream123');
      createIterations(24, [1]);

      const { launch } = await import('rover-common');
      vi.mocked(launch).mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        failed: false,
        timedOut: false,
        isCanceled: false,
        killed: false,
      } as any);

      await logsCommand('24', undefined, { follow: true });

      // Verify that inherit is used for stdout and stderr
      expect(launch).toHaveBeenCalledWith(
        'docker',
        ['logs', '-f', 'stream123'],
        expect.objectContaining({
          stdout: ['inherit'],
          stderr: ['inherit'],
          cancelSignal: expect.any(AbortSignal),
        })
      );
    });

    it('should handle follow mode completion and errors', async () => {
      await createTestTaskWithContainer(
        25,
        'Follow Complete Task',
        'complete123'
      );
      createIterations(25, [1]);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { launch } = await import('rover-common');

      // Test successful completion
      vi.mocked(launch).mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        failed: false,
        timedOut: false,
        isCanceled: false,
        killed: false,
      } as any);

      await logsCommand('25', undefined, { follow: true });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Log following completed')
      );

      consoleSpy.mockRestore();
    });

    it('should handle follow mode with non-zero exit code', async () => {
      await createTestTaskWithContainer(
        26,
        'Failed Complete Task',
        'failed123'
      );
      createIterations(26, [1]);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { launch } = await import('rover-common');

      // Test non-zero exit code
      vi.mocked(launch).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        failed: true,
        timedOut: false,
        isCanceled: false,
        killed: false,
      } as any);

      await logsCommand('26', undefined, { follow: true });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠ Log following ended with code 1')
      );

      consoleSpy.mockRestore();
    });

    it('should handle follow mode with specific iteration', async () => {
      await createTestTaskWithContainer(
        14,
        'Follow Iteration Task',
        'follow456'
      );
      createIterations(14, [1, 2, 3]);

      const { launch } = await import('rover-common');
      vi.mocked(launch).mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        failed: false,
        timedOut: false,
        isCanceled: false,
        killed: false,
      } as any);

      await logsCommand('14', '2', { follow: true });

      expect(launch).toHaveBeenCalledWith(
        'docker',
        ['logs', '-f', 'follow456'],
        expect.objectContaining({
          stdout: ['inherit'],
          stderr: ['inherit'],
          cancelSignal: expect.any(AbortSignal),
        })
      );
    });

    it('should skip follow mode in JSON mode', async () => {
      await createTestTaskWithContainer(
        15,
        'JSON Follow Task',
        'jsonfollow123'
      );
      createIterations(15, [1]);

      const { launchSync, launch } = await import('rover-common');

      vi.mocked(launchSync).mockReturnValue({
        stdout: 'JSON follow logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('15', undefined, { follow: true, json: true });

      // Should use launchSync instead of launch for JSON mode
      expect(launchSync).toHaveBeenCalledWith('docker', [
        'logs',
        'jsonfollow123',
      ]);
      expect(launch).not.toHaveBeenCalled();
    });
  });

  describe('Iteration selection', () => {
    it('should use latest iteration when none specified', async () => {
      await createTestTaskWithContainer(
        16,
        'Latest Iteration Task',
        'latest123'
      );
      createIterations(16, [1, 3, 2]); // Unsorted to test sorting

      const { launchSync } = await import('rover-common');
      vi.mocked(launchSync).mockReturnValue({
        stdout: 'Latest iteration logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('16');

      expect(launchSync).toHaveBeenCalledWith('docker', ['logs', 'latest123']);
    });

    it('should use specific iteration when provided', async () => {
      await createTestTaskWithContainer(
        17,
        'Specific Iteration Task',
        'specific123'
      );
      createIterations(17, [1, 2, 3]);

      const { launchSync } = await import('rover-common');
      vi.mocked(launchSync).mockReturnValue({
        stdout: 'Specific iteration logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('17', '2');

      expect(launchSync).toHaveBeenCalledWith('docker', [
        'logs',
        'specific123',
      ]);
    });
  });

  describe('Combined scenarios', () => {
    it('should handle task with single iteration', async () => {
      await createTestTaskWithContainer(
        18,
        'Single Iteration Task',
        'single123'
      );
      createIterations(18, [1]);

      const { launchSync } = await import('rover-common');
      vi.mocked(launchSync).mockReturnValue({
        stdout: 'Single iteration logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('18');

      expect(launchSync).toHaveBeenCalledWith('docker', ['logs', 'single123']);
    });

    it('should handle task with many iterations', async () => {
      await createTestTaskWithContainer(19, 'Many Iterations Task', 'many123');
      createIterations(19, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const { launchSync } = await import('rover-common');
      vi.mocked(launchSync).mockReturnValue({
        stdout: 'Many iterations logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('19', '5');

      expect(launchSync).toHaveBeenCalledWith('docker', ['logs', 'many123']);
    });
  });

  describe('Telemetry integration', () => {
    it('should call telemetry on successful logs retrieval', async () => {
      await createTestTaskWithContainer(20, 'Telemetry Task', 'telemetry123');
      createIterations(20, [1]);

      const { getTelemetry } = await import('../../lib/telemetry.js');
      const { launchSync } = await import('rover-common');

      const mockTelemetry = getTelemetry();
      vi.mocked(launchSync).mockReturnValue({
        stdout: 'Telemetry logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
      } as any);

      await logsCommand('20');

      expect(mockTelemetry?.eventLogs).toHaveBeenCalled();
      expect(mockTelemetry?.shutdown).toHaveBeenCalled();
    });

    it('should call telemetry shutdown even on failure', async () => {
      const { getTelemetry } = await import('../../lib/telemetry.js');
      const mockTelemetry = getTelemetry();

      await logsCommand('999'); // Non-existent task

      expect(mockTelemetry?.shutdown).toHaveBeenCalled();
    });
  });
});
