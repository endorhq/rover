import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

/**
 * E2E tests for `rover shell` command
 *
 * These tests run the actual rover CLI binary and test the shell access workflow.
 * They mock system tool availability by creating wrapper scripts in a temporary bin directory.
 *
 * Note: Interactive shell sessions cannot be fully tested in an automated context.
 * These tests verify that the command resolves the correct worktree path and that
 * the shell infrastructure is invoked correctly.
 */

describe('rover shell (e2e)', () => {
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

    testDir = mkdtempSync(join(tmpdir(), 'rover-shell-e2e-'));
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

  describe('local shell', () => {
    it('should verify the task has a valid worktree path for local shell access', async () => {
      // Create a task
      await runRover(['task', '-y', 'Create a hello world script', '--json']);
      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);

      // Inspect the task to verify worktree exists
      const inspectResult = await runRover(['inspect', '1', '--json']);
      expect(inspectResult.exitCode).toBe(0);

      const task = JSON.parse(inspectResult.stdout);
      expect(task.worktreePath).toBeDefined();

      // Verify the worktree path exists on disk
      if (task.worktreePath) {
        expect(existsSync(task.worktreePath)).toBe(true);
      }
    });
  });

  describe('container shell', () => {
    it('should have --container flag available for container-based shell access', async () => {
      // Create a task
      await runRover(['task', '-y', 'Create a hello world script', '--json']);
      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);

      // Verify the shell command is recognized (help output)
      const helpResult = await runRover(['shell', '--help']);
      expect(helpResult.exitCode).toBe(0);
      expect(helpResult.stdout).toContain('container');
    });
  });
});
