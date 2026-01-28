import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

/**
 * E2E tests for `rover delete` (alias `rover del`) command
 *
 * These tests run the actual rover CLI binary and test the full task deletion workflow.
 * They mock system tool availability by creating wrapper scripts in a temporary bin directory.
 */

describe('rover delete (e2e)', () => {
  let testDir: string;
  let originalCwd: string;
  let mockBinDir: string;
  let originalPath: string;

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

  const createMockScript = (toolName: string, scriptContent: string) => {
    const scriptPath = join(mockBinDir, toolName);
    writeFileSync(scriptPath, scriptContent);
    chmodSync(scriptPath, 0o755);
  };

  const createMockClaude = () => {
    createMockScript(
      'claude',
      `#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then
  echo "Claude CLI v1.0.0"
  exit 0
fi

if [[ "$1" == "-p" ]]; then
  PROMPT=$(cat)
  if [[ "$2" == "--output-format" && "$3" == "json" ]]; then
    echo '{"result":"{\\"title\\":\\"Test task\\",\\"description\\":\\"A test task description.\\"}"}'
  else
    echo '{"title":"Test task","description":"A test task description."}'
  fi
  exit 0
fi

echo "Claude CLI v1.0.0"
exit 0
`
    );
  };

  const roverBin = join(__dirname, '../../../dist/index.mjs');

  const runRover = async (args: string[]) => {
    const testPath = `${mockBinDir}:${originalPath}`;
    return execa('node', [roverBin, ...args], {
      cwd: testDir,
      env: {
        PATH: testPath,
        HOME: process.env.HOME,
        USER: process.env.USER,
        TMPDIR: process.env.TMPDIR,
        ROVER_NO_TELEMETRY: '1',
      },
      reject: false,
    });
  };

  const waitForTaskStatus = async (
    taskId: number,
    expectedStatuses: string[],
    timeoutMs: number = 600000
  ): Promise<string> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const result = await runRover(['inspect', String(taskId), '--json']);
      if (result.exitCode === 0) {
        const output = JSON.parse(result.stdout);
        if (expectedStatuses.includes(output.status)) return output.status;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(
      `Timeout waiting for task ${taskId} to reach one of statuses: ${expectedStatuses.join(', ')}`
    );
  };

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalPath = process.env.PATH || '';

    testDir = mkdtempSync(join(tmpdir(), 'rover-delete-e2e-'));
    process.chdir(testDir);

    mockBinDir = join(testDir, '.mock-bin');
    mkdirSync(mockBinDir, { recursive: true });

    process.env.PATH = `${mockBinDir}:${originalPath}`;

    createMockTool('docker', 127, 'command not found: docker');
    createMockTool('claude', 127, 'command not found: claude');
    createMockTool('codex', 127, 'command not found: codex');
    createMockTool('cursor', 127, 'command not found: cursor');
    createMockTool('cursor-agent', 127, 'command not found: cursor-agent');
    createMockTool('gemini', 127, 'command not found: gemini');
    createMockTool('qwen', 127, 'command not found: qwen');

    createMockTool('docker', 0, 'Docker version 24.0.0');
    createMockClaude();

    await execa('git', ['init']);
    await execa('git', ['config', 'user.email', 'test@test.com']);
    await execa('git', ['config', 'user.name', 'Test User']);
    await execa('git', ['config', 'commit.gpgsign', 'false']);

    writeFileSync(
      'package.json',
      JSON.stringify({ name: 'test-project', version: '1.0.0', type: 'module' }, null, 2)
    );
    writeFileSync('README.md', '# Test Project\n');

    await execa('git', ['add', '.']);
    await execa('git', ['commit', '-m', 'Initial commit']);

    await runRover(['init', '--yes']);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('single task deletion', () => {
    it('should delete a task and remove its metadata', async () => {
      // Create a task
      await runRover(['task', '-y', 'Create a hello world script', '--json']);
      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);

      // Stop the task first
      await runRover(['stop', '1']);

      // Delete the task with --yes to skip confirmation
      const deleteResult = await runRover(['delete', '1', '--yes', '--json']);

      expect(deleteResult.exitCode).toBe(0);

      // Verify task is gone from listing
      const listResult = await runRover(['list', '--json']);
      expect(listResult.exitCode).toBe(0);
      const tasks = JSON.parse(listResult.stdout);
      const deletedTask = tasks.find((t: { id: number }) => t.id === 1);
      expect(deletedTask).toBeUndefined();
    });

    it('should prune associated git worktree on deletion', async () => {
      await runRover(['task', '-y', 'Create a hello world script', '--json']);
      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);

      await runRover(['stop', '1']);

      await runRover(['delete', '1', '--yes', '--json']);

      // Verify worktree was pruned
      const worktreeResult = await execa('git', ['worktree', 'list'], {
        cwd: testDir,
      });
      const worktreeLines = worktreeResult.stdout.split('\n').filter(line => line.trim());
      // Should only have the main worktree left
      expect(worktreeLines.length).toBe(1);
    });
  });

  describe('bulk deletion', () => {
    it('should delete multiple tasks when multiple IDs are provided', async () => {
      // Create two tasks
      await runRover(['task', '-y', 'Create first script', '--json']);
      await runRover(['task', '-y', 'Create second script', '--json']);

      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);
      await waitForTaskStatus(2, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);

      // Stop both tasks
      await runRover(['stop', '1']);
      await runRover(['stop', '2']);

      // Delete both tasks
      const deleteResult = await runRover([
        'delete',
        '1',
        '2',
        '--yes',
        '--json',
      ]);

      expect(deleteResult.exitCode).toBe(0);

      // Verify both tasks are gone
      const listResult = await runRover(['list', '--json']);
      expect(listResult.exitCode).toBe(0);
      const tasks = JSON.parse(listResult.stdout);
      expect(tasks.length).toBe(0);
    });
  });

  describe('deletion confirmation', () => {
    it('should skip confirmation with --yes flag', async () => {
      await runRover(['task', '-y', 'Create a hello world script', '--json']);
      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);
      await runRover(['stop', '1']);

      // --yes flag should skip the confirmation prompt
      const deleteResult = await runRover(['delete', '1', '--yes', '--json']);

      expect(deleteResult.exitCode).toBe(0);
    });

    it('should skip confirmation in JSON mode', async () => {
      await runRover(['task', '-y', 'Create a hello world script', '--json']);
      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);
      await runRover(['stop', '1']);

      // --json mode should also skip confirmation
      const deleteResult = await runRover(['delete', '1', '--json']);

      expect(deleteResult.exitCode).toBe(0);
    });
  });

  describe('alias support', () => {
    it('should work with the del alias', async () => {
      await runRover(['task', '-y', 'Create a hello world script', '--json']);
      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);
      await runRover(['stop', '1']);

      const deleteResult = await runRover(['del', '1', '--yes', '--json']);

      expect(deleteResult.exitCode).toBe(0);
    });
  });
});
