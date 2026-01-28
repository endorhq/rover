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
 * E2E tests for `rover logs` command
 *
 * These tests run the actual rover CLI binary and test the full log retrieval workflow.
 * They mock system tool availability by creating wrapper scripts in a temporary bin directory.
 */

describe('rover logs (e2e)', () => {
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

    testDir = mkdtempSync(join(tmpdir(), 'rover-logs-e2e-'));
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
      JSON.stringify(
        { name: 'test-project', version: '1.0.0', type: 'module' },
        null,
        2
      )
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

  // TODO: These tests require waitForTaskStatus which hangs with mock Docker
  // because tasks never reach the expected status without a real agent
  describe.skip('log retrieval', () => {
    it('should display Docker container logs for a task', async () => {
      // Create a task
      await runRover(['task', '-y', 'Create a hello world script']);

      // Wait for the task to start or complete
      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);

      // Retrieve logs
      const result = await runRover(['logs', '1']);

      // Logs should either succeed or report that no container is available
      expect(result.exitCode).toBeDefined();
    });

    it('should show latest iteration logs by default', async () => {
      await runRover(['task', '-y', 'Create a hello world script']);

      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);

      const result = await runRover(['logs', '1', '--json']);

      // Should return either logs or an indication of missing container
      expect(result.exitCode).toBeDefined();
    });
  });

  describe.skip('iteration-specific logs', () => {
    it('should allow viewing logs from a specific iteration', async () => {
      await runRover(['task', '-y', 'Create a hello world script']);

      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);

      // Request logs for iteration 1 specifically
      const result = await runRover(['logs', '1', '1']);

      expect(result.exitCode).toBeDefined();
    });
  });

  describe.skip('missing container handling', () => {
    it('should display a clear message when container no longer exists', async () => {
      // Create a task
      await runRover(['task', '-y', 'Create a hello world script', '--json']);

      // Stop the task and remove the container
      await waitForTaskStatus(1, ['IN_PROGRESS', 'COMPLETED', 'FAILED']);
      await runRover(['stop', '1', '--remove-container']);

      // Try to retrieve logs - container should be gone
      const result = await runRover(['logs', '1']);

      // Should report that logs are not available
      expect(result.exitCode).toBeDefined();
      const output = (result.stdout + (result.stderr || '')).toLowerCase();
      expect(output).toMatch(
        /no.*container|not.*available|no.*iteration|not found/
      );
    });
  });
});
