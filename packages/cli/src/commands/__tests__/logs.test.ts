import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { logsCommand } from '../logs.js';
import { TaskDescription } from '../../lib/description.js';

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventLogs: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined)
  })
}));

// Mock enquirer (not used in logs but imported indirectly)
vi.mock('enquirer', () => ({
  default: {
    prompt: vi.fn()
  }
}));

// Mock exit utilities to prevent process.exit
vi.mock('../../utils/exit.js', () => ({
  exitWithError: vi.fn().mockImplementation(() => { }),
  exitWithSuccess: vi.fn().mockImplementation(() => { }),
  exitWithWarn: vi.fn().mockImplementation(() => { })
}));

// Mock display utilities to suppress output
vi.mock('../../utils/display.js', () => ({
  showRoverChat: vi.fn(),
  showTips: vi.fn(),
  TIP_TITLES: {}
}));

// Mock the OS utilities for Docker commands
vi.mock('../../lib/os.js', () => ({
  spawnSync: vi.fn(),
  spawn: vi.fn()
}));

// Mock child_process spawn for follow mode
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn()
}));

describe('logs command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory with git repo
    testDir = mkdtempSync(join(tmpdir(), 'rover-logs-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize git repo
    execSync('git init', { stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { stdio: 'pipe' });
    execSync('git config user.name "Test User"', { stdio: 'pipe' });
    execSync('git config commit.gpgsign false', { stdio: 'pipe' });

    // Create initial commit
    writeFileSync('README.md', '# Test');
    execSync('git add .', { stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { stdio: 'pipe' });

    // Create .rover directory structure
    mkdirSync('.rover/tasks', { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // Helper to create a test task with container ID
  const createTestTaskWithContainer = (id: number, title: string = 'Test Task', containerId?: string) => {
    const task = TaskDescription.create({
      id,
      title,
      description: 'Test task description'
    });

    // Create a git worktree for the task
    const worktreePath = join('.rover', 'tasks', id.toString(), 'workspace');
    const branchName = `rover-task-${id}`;

    execSync(`git worktree add ${worktreePath} -b ${branchName}`, { stdio: 'pipe' });
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
          error: "Invalid task ID 'invalid' - must be a number"
        }),
        false
      );
    });

    it('should reject empty task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid task ID '' - must be a number"
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
          error: 'The task with ID 1 was not found'
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
          error: 'The task with ID 999 was not found'
        }),
        false
      );
    });

    it('should handle negative task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('-1');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'The task with ID -1 was not found'
        }),
        false
      );
    });
  });

  describe('Iteration validation', () => {
    it('should reject non-numeric iteration number', async () => {
      createTestTaskWithContainer(1, 'Test Task', 'container123');
      createIterations(1, [1, 2]);

      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('1', 'invalid');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid iteration number: 'invalid'"
        }),
        false
      );
    });

    it('should handle non-existent iteration', async () => {
      createTestTaskWithContainer(2, 'Test Task', 'container123');
      createIterations(2, [1, 2]);

      const { exitWithError } = await import('../../utils/exit.js');

      await logsCommand('2', '5');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Iteration 5 not found for task \'2\'. Available iterations: 1, 2'
        }),
        false
      );
    });
  });

  describe('No iterations scenarios', () => {
    it('should warn when no iterations found', async () => {
      createTestTaskWithContainer(3, 'No Iterations Task', 'container123');

      const { exitWithWarn } = await import('../../utils/exit.js');

      await logsCommand('3');

      expect(exitWithWarn).toHaveBeenCalledWith(
        "No iterations found for task '3'",
        expect.objectContaining({
          logs: '',
          success: false
        }),
        false
      );
    });

    it('should warn when no iterations found in JSON mode', async () => {
      createTestTaskWithContainer(4, 'No Iterations Task', 'container123');

      const { exitWithWarn } = await import('../../utils/exit.js');

      await logsCommand('4', undefined, { json: true });

      expect(exitWithWarn).toHaveBeenCalledWith(
        "No iterations found for task '4'",
        expect.objectContaining({
          logs: '',
          success: false
        }),
        true
      );
    });
  });

  describe('No container scenarios', () => {
    it('should warn when no container found', async () => {
      createTestTaskWithContainer(5, 'No Container Task'); // No container ID provided
      createIterations(5, [1]);

      const { exitWithWarn } = await import('../../utils/exit.js');

      await logsCommand('5');

      expect(exitWithWarn).toHaveBeenCalledWith(
        "No container found for task '5'. Logs are only available for recent tasks",
        expect.objectContaining({
          logs: '',
          success: false
        }),
        false
      );
    });

    it('should warn when no container found in JSON mode', async () => {
      createTestTaskWithContainer(6, 'No Container Task'); // No container ID provided
      createIterations(6, [1]);

      const { exitWithWarn } = await import('../../utils/exit.js');

      await logsCommand('6', undefined, { json: true });

      expect(exitWithWarn).toHaveBeenCalledWith(
        "No container found for task '6'. Logs are only available for recent tasks",
        expect.objectContaining({
          logs: '',
          success: false
        }),
        true
      );
    });
  });

  describe('Docker logs retrieval', () => {
    it('should successfully retrieve and display logs', async () => {
      createTestTaskWithContainer(7, 'Success Task', 'container123');
      createIterations(7, [1, 2]);

      const { spawnSync } = await import('../../lib/os.js');
      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'Log line 1\nLog line 2\nLog line 3',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
      } as any);

      await logsCommand('7');

      expect(spawnSync).toHaveBeenCalledWith('docker', ['logs', 'container123'], {
        encoding: 'utf8',
        stdio: 'pipe'
      });
    });

    it('should print logs to console output', async () => {
      createTestTaskWithContainer(21, 'Console Output Task', 'console123');
      createIterations(21, [1]);

      const { spawnSync } = await import('../../lib/os.js');
      
      // Mock console.log to capture output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const testLogs = 'Starting application...\nProcessing data...\nTask completed successfully!\n\nFinal status: OK';
      
      vi.mocked(spawnSync).mockReturnValue({
        stdout: testLogs,
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
      } as any);

      await logsCommand('21');

      // Verify header information is printed
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Task 21 Logs'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Console Output Task'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Iteration:'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Execution Log'));

      // Verify each log line is printed
      expect(consoleSpy).toHaveBeenCalledWith('Starting application...');
      expect(consoleSpy).toHaveBeenCalledWith('Processing data...');
      expect(consoleSpy).toHaveBeenCalledWith('Task completed successfully!');
      expect(consoleSpy).toHaveBeenCalledWith(''); // Empty line
      expect(consoleSpy).toHaveBeenCalledWith('Final status: OK');

      consoleSpy.mockRestore();
    });

    it('should print logs with special characters and formatting', async () => {
      createTestTaskWithContainer(22, 'Special Chars Task', 'special123');
      createIterations(22, [1]);

      const { spawnSync } = await import('../../lib/os.js');
      
      // Mock console.log to capture output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const testLogs = '[ERROR] Failed to connect\n→ Retrying...\n✓ Connected!\n{ "status": "ok" }\nTab\there';
      
      vi.mocked(spawnSync).mockReturnValue({
        stdout: testLogs,
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
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
      createTestTaskWithContainer(23, 'Multiline Task', 'multiline123');
      createIterations(23, [1]);

      const { spawnSync } = await import('../../lib/os.js');
      
      // Mock console.log to capture output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const testLogs = `Line 1
Line 2

Line 4 (after empty line)


Line 7 (after two empty lines)
Last line`;
      
      vi.mocked(spawnSync).mockReturnValue({
        stdout: testLogs,
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
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
      createTestTaskWithContainer(8, 'JSON Task', 'container456');
      createIterations(8, [1]);

      const { spawnSync } = await import('../../lib/os.js');
      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'JSON log output\nAnother line',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
      } as any);

      await logsCommand('8', undefined, { json: true });

      expect(spawnSync).toHaveBeenCalledWith('docker', ['logs', 'container456'], {
        encoding: 'utf8',
        stdio: 'pipe'
      });
    });

    it('should handle empty logs', async () => {
      createTestTaskWithContainer(9, 'Empty Logs Task', 'container789');
      createIterations(9, [1]);

      const { spawnSync } = await import('../../lib/os.js');
      const { exitWithWarn } = await import('../../utils/exit.js');

      vi.mocked(spawnSync).mockReturnValue({
        stdout: '   \n   \n   ', // Just whitespace
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
      } as any);

      await logsCommand('9');

      expect(exitWithWarn).toHaveBeenCalledWith(
        'No logs available for this container. Logs are only available for recent tasks',
        expect.objectContaining({
          logs: '',
          success: false
        }),
        false
      );
    });
  });

  describe('Docker error scenarios', () => {
    it('should handle "No such container" error', async () => {
      createTestTaskWithContainer(10, 'Missing Container Task', 'nonexistent123');
      createIterations(10, [1]);

      const { spawnSync } = await import('../../lib/os.js');
      const { exitWithWarn } = await import('../../utils/exit.js');

      vi.mocked(spawnSync).mockImplementation(() => {
        throw new Error('No such container: nonexistent123');
      });

      await logsCommand('10');

      expect(exitWithWarn).toHaveBeenCalledWith(
        'No logs available for this container. Logs are only available for recent tasks',
        expect.objectContaining({
          logs: '',
          success: false
        }),
        false
      );
    });

    it('should handle general Docker errors', async () => {
      createTestTaskWithContainer(11, 'Docker Error Task', 'error123');
      createIterations(11, [1]);

      const { spawnSync } = await import('../../lib/os.js');
      const { exitWithError } = await import('../../utils/exit.js');

      vi.mocked(spawnSync).mockImplementation(() => {
        throw new Error('Docker daemon not running');
      });

      await logsCommand('11');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Error retrieving container logs: Docker daemon not running'
        }),
        false
      );
    });

    it('should handle Docker permission errors', async () => {
      createTestTaskWithContainer(12, 'Permission Error Task', 'perm123');
      createIterations(12, [1]);

      const { spawnSync } = await import('../../lib/os.js');
      const { exitWithError } = await import('../../utils/exit.js');

      vi.mocked(spawnSync).mockImplementation(() => {
        throw new Error('permission denied while trying to connect to the Docker daemon socket');
      });

      await logsCommand('12');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Error retrieving container logs: permission denied while trying to connect to the Docker daemon socket'
        }),
        false
      );
    });
  });

  describe('Follow mode', () => {
    it('should start follow mode with valid container', async () => {
      createTestTaskWithContainer(13, 'Follow Task', 'follow123');
      createIterations(13, [1]);

      const mockSpawn = vi.fn();
      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn()
      };

      const { spawn } = await import('node:child_process');
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await logsCommand('13', undefined, { follow: true });

      expect(spawn).toHaveBeenCalledWith('docker', ['logs', '-f', 'follow123'], {
        stdio: ['inherit', 'pipe', 'pipe']
      });

      // Verify event listeners are set up
      expect(mockProcess.stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockProcess.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should stream logs in follow mode to stdout and stderr', async () => {
      createTestTaskWithContainer(24, 'Stream Task', 'stream123');
      createIterations(24, [1]);

      // Mock process.stdout and stderr
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      let stdoutCallback: any;
      let stderrCallback: any;

      const mockProcess = {
        stdout: { 
          on: vi.fn((event, callback) => {
            if (event === 'data') stdoutCallback = callback;
          })
        },
        stderr: { 
          on: vi.fn((event, callback) => {
            if (event === 'data') stderrCallback = callback;
          })
        },
        on: vi.fn(),
        kill: vi.fn()
      };

      const { spawn } = await import('node:child_process');
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await logsCommand('24', undefined, { follow: true });

      // Simulate data coming from stdout
      const stdoutData = Buffer.from('Stdout log line 1\nStdout log line 2\n');
      stdoutCallback(stdoutData);

      // Simulate data coming from stderr
      const stderrData = Buffer.from('[ERROR] Something went wrong\n');
      stderrCallback(stderrData);

      // Verify data was written to process streams
      expect(stdoutSpy).toHaveBeenCalledWith(stdoutData);
      expect(stderrSpy).toHaveBeenCalledWith(stderrData);

      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it('should handle follow mode completion and errors', async () => {
      createTestTaskWithContainer(25, 'Follow Complete Task', 'complete123');
      createIterations(25, [1]);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      let closeCallback: any;
      let errorCallback: any;

      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') closeCallback = callback;
          if (event === 'error') errorCallback = callback;
        }),
        kill: vi.fn()
      };

      const { spawn } = await import('node:child_process');
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await logsCommand('25', undefined, { follow: true });

      // Test successful completion
      closeCallback(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✓ Log following completed'));

      // Test error scenario
      const testError = new Error('Connection lost');
      errorCallback(testError);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error following logs:'), 'Connection lost');

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should handle follow mode with specific iteration', async () => {
      createTestTaskWithContainer(14, 'Follow Iteration Task', 'follow456');
      createIterations(14, [1, 2, 3]);

      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn()
      };

      const { spawn } = await import('node:child_process');
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      await logsCommand('14', '2', { follow: true });

      expect(spawn).toHaveBeenCalledWith('docker', ['logs', '-f', 'follow456'], {
        stdio: ['inherit', 'pipe', 'pipe']
      });
    });

    it('should skip follow mode in JSON mode', async () => {
      createTestTaskWithContainer(15, 'JSON Follow Task', 'jsonfollow123');
      createIterations(15, [1]);

      const { spawnSync } = await import('../../lib/os.js');
      const { spawn } = await import('node:child_process');

      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'JSON follow logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
      } as any);

      await logsCommand('15', undefined, { follow: true, json: true });

      // Should use spawnSync instead of spawn for JSON mode
      expect(spawnSync).toHaveBeenCalledWith('docker', ['logs', 'jsonfollow123'], {
        encoding: 'utf8',
        stdio: 'pipe'
      });
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('Iteration selection', () => {
    it('should use latest iteration when none specified', async () => {
      createTestTaskWithContainer(16, 'Latest Iteration Task', 'latest123');
      createIterations(16, [1, 3, 2]); // Unsorted to test sorting

      const { spawnSync } = await import('../../lib/os.js');
      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'Latest iteration logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
      } as any);

      await logsCommand('16');

      expect(spawnSync).toHaveBeenCalledWith('docker', ['logs', 'latest123'], {
        encoding: 'utf8',
        stdio: 'pipe'
      });
    });

    it('should use specific iteration when provided', async () => {
      createTestTaskWithContainer(17, 'Specific Iteration Task', 'specific123');
      createIterations(17, [1, 2, 3]);

      const { spawnSync } = await import('../../lib/os.js');
      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'Specific iteration logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
      } as any);

      await logsCommand('17', '2');

      expect(spawnSync).toHaveBeenCalledWith('docker', ['logs', 'specific123'], {
        encoding: 'utf8',
        stdio: 'pipe'
      });
    });
  });

  describe('Combined scenarios', () => {
    it('should handle task with single iteration', async () => {
      createTestTaskWithContainer(18, 'Single Iteration Task', 'single123');
      createIterations(18, [1]);

      const { spawnSync } = await import('../../lib/os.js');
      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'Single iteration logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
      } as any);

      await logsCommand('18');

      expect(spawnSync).toHaveBeenCalledWith('docker', ['logs', 'single123'], {
        encoding: 'utf8',
        stdio: 'pipe'
      });
    });

    it('should handle task with many iterations', async () => {
      createTestTaskWithContainer(19, 'Many Iterations Task', 'many123');
      createIterations(19, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const { spawnSync } = await import('../../lib/os.js');
      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'Many iterations logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
      } as any);

      await logsCommand('19', '5');

      expect(spawnSync).toHaveBeenCalledWith('docker', ['logs', 'many123'], {
        encoding: 'utf8',
        stdio: 'pipe'
      });
    });
  });

  describe('Telemetry integration', () => {
    it('should call telemetry on successful logs retrieval', async () => {
      createTestTaskWithContainer(20, 'Telemetry Task', 'telemetry123');
      createIterations(20, [1]);

      const { getTelemetry } = await import('../../lib/telemetry.js');
      const { spawnSync } = await import('../../lib/os.js');

      const mockTelemetry = getTelemetry();
      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'Telemetry logs',
        stderr: '',
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234
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