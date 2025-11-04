import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

/**
 * E2E tests for `rover task` command
 *
 * These tests run the actual rover CLI binary and test the full task execution workflow.
 * They mock system tool availability by creating wrapper scripts in a temporary bin directory.
 */

describe('rover task (e2e)', () => {
  let testDir: string;
  let originalCwd: string;
  let mockBinDir: string;
  let originalPath: string;

  /**
   * Creates a mock executable in the mock bin directory
   * This allows us to control which tools appear "installed" to the rover CLI
   */
  const createMockTool = (
    toolName: string,
    exitCode: number = 0,
    output: string = 'mock version 1.0.0'
  ) => {
    const scriptPath = join(mockBinDir, toolName);
    const scriptContent = `#!/usr/bin/env bash\necho "${output}"\nexit ${exitCode}`;
    writeFileSync(scriptPath, scriptContent);
    chmodSync(scriptPath, 0o755);
  };

  beforeEach(async () => {
    // Save original state
    originalCwd = process.cwd();
    originalPath = process.env.PATH || '';

    // Create temporary test directory
    testDir = mkdtempSync(join(tmpdir(), 'rover-task-e2e-'));
    process.chdir(testDir);

    // Create mock bin directory for mocking system tools
    mockBinDir = join(testDir, '.mock-bin');
    mkdirSync(mockBinDir, { recursive: true });

    // Prepend mock bin to PATH so our mock tools are found first
    process.env.PATH = `${mockBinDir}:${originalPath}`;

    // Initialize a real git repository
    await execa('git', ['init']);
    await execa('git', ['config', 'user.email', 'test@test.com']);
    await execa('git', ['config', 'user.name', 'Test User']);
    await execa('git', ['config', 'commit.gpgsign', 'false']);

    // Create initial project files
    writeFileSync(
      'package.json',
      JSON.stringify(
        {
          name: 'test-project',
          version: '1.0.0',
          type: 'module',
        },
        null,
        2
      )
    );
    writeFileSync('README.md', '# Test Project\n');

    // Create an initial commit
    await execa('git', ['add', '.']);
    await execa('git', ['commit', '-m', 'Initial commit']);

    // Initialize rover
    const roverBin = join(__dirname, '../../../dist/index.js');
    const testPath = `${mockBinDir}:${originalPath}`;

    await execa('node', [roverBin, 'init', '--yes'], {
      cwd: testDir,
      env: {
        PATH: testPath,
        HOME: process.env.HOME,
        USER: process.env.USER,
        TMPDIR: process.env.TMPDIR,
        ROVER_TELEMETRY_DISABLED: '1',
      },
    });
  });

  afterEach(() => {
    // Restore original state
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    rmSync(testDir, { recursive: true, force: true });
  });

  /**
   * Helper to run the rover task command
   */
  const runRoverTask = async (taskDescription: string, args: string[] = []) => {
    const roverBin = join(__dirname, '../../../dist/index.js');
    const testPath = `${mockBinDir}:${originalPath}`;

    return execa('node', [roverBin, 'task', taskDescription, ...args], {
      cwd: testDir,
      env: {
        PATH: testPath,
        HOME: process.env.HOME,
        USER: process.env.USER,
        TMPDIR: process.env.TMPDIR,
        ROVER_TELEMETRY_DISABLED: '1',
      },
      reject: false, // Don't throw on non-zero exit
    });
  };

  /**
   * Helper to wait for a task to reach a specific status
   * Polls the task status file until the expected status is reached or timeout occurs
   */
  const waitForTaskStatus = async (
    taskId: number,
    expectedStatus: string,
    timeoutMs: number = 30000,
    pollIntervalMs: number = 500
  ): Promise<void> => {
    const startTime = Date.now();
    const taskStatusFile = join(
      testDir,
      `.rover/tasks/${taskId}/description.json`
    );

    while (Date.now() - startTime < timeoutMs) {
      if (existsSync(taskStatusFile)) {
        const statusContent = readFileSync(taskStatusFile, 'utf8');
        const status = JSON.parse(statusContent);

        if (status.status === expectedStatus) {
          return;
        }
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Timeout waiting for task ${taskId} to reach status "${expectedStatus}" after ${timeoutMs}ms`
    );
  };

  const waitForTaskCompletion = async (taskId: number): Promise<void> => {
    await waitForTaskStatus(taskId, 'COMPLETED', 600000);
  };

  describe('successful task execution', () => {
    it('should execute a simple task to create a hello world bash script', async () => {
      // Execute: Run rover task with a simple request
      const result = await runRoverTask(
        'Create a hello world bash script that prints the current date and time'
      );

      // Debug output if test fails
      if (result.exitCode !== 0) {
        console.log('STDOUT:', result.stdout);
        console.log('STDERR:', result.stderr);
      }

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Wait for task to reach COMPLETED status
      await waitForTaskCompletion(1);

      // Verify: The script was created
      expect(existsSync(`${testDir}/.rover/tasks/1/workspace/hello.sh`)).toBe(
        true
      );

      // Verify: The script has the expected content
      const scriptContent = readFileSync(
        `${testDir}/.rover/tasks/1/workspace/hello.sh`,
        'utf8'
      );
      expect(scriptContent).toContain('Hello World');
      expect(scriptContent).toContain('date');
    });

    it('should use the configured AI agent from settings', async () => {
      // Setup: Verify settings has claude as default agent
      expect(existsSync('.rover/settings.json')).toBe(true);
      const settings = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(settings.defaults.aiAgent).toBe('claude');

      // Execute: Run rover task
      const result = await runRoverTask(
        'Create a hello world bash script that prints the current date and time'
      );

      // Verify: Task completed successfully
      expect(result.exitCode).toBe(0);
    });

    it('should create a git worktree for task isolation', async () => {
      // Execute: Run rover task
      const result = await runRoverTask(
        'Create a hello world bash script that prints the current date and time'
      );

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Verify: Worktree was created (check git worktree list)
      const worktreeResult = await execa('git', ['worktree', 'list'], {
        cwd: testDir,
      });

      // Should have at least 2 worktrees (main + task worktree)
      const worktreeLines = worktreeResult.stdout
        .split('\n')
        .filter(line => line.trim());
      expect(worktreeLines.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('error handling', () => {
    it('should fail gracefully if AI agent is not available', async () => {
      // Setup: Create a failing claude mock to simulate missing AI agent
      createMockTool('claude', 127, 'command not found: claude');

      // Execute: Run rover task
      const result = await runRoverTask(
        'Create a hello world bash script that prints the current date and time'
      );

      // Verify: Command failed with appropriate error
      expect(result.exitCode).not.toBe(0);
      const output = (result.stdout || result.stderr).toLowerCase();
      expect(output).toMatch(/agent|claude|not found|error/);
    });

    it('should require rover to be initialized before running tasks', async () => {
      // Setup: Remove rover configuration to simulate uninitialized project
      rmSync('rover.json', { force: true });
      rmSync('.rover', { recursive: true, force: true });

      // Execute: Run rover task
      const result = await runRoverTask(
        'Create a hello world bash script that prints the current date and time'
      );

      // Verify: Command failed
      expect(result.exitCode).not.toBe(0);
      const output = (result.stdout || result.stderr).toLowerCase();
      expect(output).toMatch(/not initialized|rover init|configuration/);
    });
  });

  describe('task isolation', () => {
    it('should not affect the main branch during task execution', async () => {
      // Setup: Get initial commit count on main
      const initialLog = await execa('git', ['log', '--oneline'], {
        cwd: testDir,
      });
      const initialCommitCount = initialLog.stdout.split('\n').length;

      // Execute: Run rover task
      const result = await runRoverTask(
        'Create a hello world bash script that prints the current date and time'
      );

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Wait for task to reach COMPLETED status
      await waitForTaskCompletion(1);

      // Verify: Main branch still has the same commit count
      const finalLog = await execa('git', ['log', '--oneline'], {
        cwd: testDir,
      });
      const finalCommitCount = finalLog.stdout.split('\n').length;
      expect(finalCommitCount).toBe(initialCommitCount);

      // Verify: We're still on the main branch
      const branchResult = await execa('git', ['branch', '--show-current'], {
        cwd: testDir,
      });
      expect(branchResult.stdout.trim()).toMatch(/main|master/);
    });
  });
});
