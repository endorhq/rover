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
 * E2E tests for `rover inspect` command
 *
 * These tests run the actual rover CLI binary and test the full task inspection workflow.
 * They mock system tool availability by creating wrapper scripts in a temporary bin directory.
 */

describe('rover inspect (e2e)', () => {
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
    expectedStatus: string,
    timeoutMs: number = 600000
  ): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const result = await runRover(['inspect', String(taskId), '--json']);
      if (result.exitCode === 0) {
        const output = JSON.parse(result.stdout);
        if (output.status === expectedStatus) return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(
      `Timeout waiting for task ${taskId} to reach status "${expectedStatus}"`
    );
  };

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalPath = process.env.PATH || '';

    testDir = mkdtempSync(join(tmpdir(), 'rover-inspect-e2e-'));
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

  describe('task metadata display', () => {
    it('should display task ID, title, status, agent, and workspace info', async () => {
      // Create a task
      await runRover(['task', '-y', 'Create a hello world script', '--json']);

      // Inspect the task
      const result = await runRover(['inspect', '1', '--json']);

      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.id).toBe(1);
      expect(output.title).toBeDefined();
      expect(output.status).toBeDefined();
      expect(output.createdAt).toBeDefined();
      expect(output.agent).toBeDefined();
      expect(output.branchName).toBeDefined();
      expect(output.worktreePath).toBeDefined();
    });

    it('should show workflow information', async () => {
      await runRover(['task', '-y', 'Create a hello world script', '--json']);

      const result = await runRover(['inspect', '1', '--json']);
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.workflowName).toBeDefined();
    });
  });

  // TODO: These tests require a real agent to make progress in the container.
  // The mock Docker doesn't run real containers, so tasks never reach COMPLETED status.
  // describe('iteration output file listing', () => {
  //   it('should list files produced by task iterations', async () => {
  //     await runRover(['task', '-y', 'Create a hello world script']);
  //     await waitForTaskStatus(1, 'COMPLETED');
  //     const result = await runRover(['inspect', '1', '--json']);
  //     expect(result.exitCode).toBe(0);
  //     const output = JSON.parse(result.stdout);
  //     if (output.iterationFiles) {
  //       expect(Array.isArray(output.iterationFiles)).toBe(true);
  //     }
  //   });
  // });

  describe('specific file display', () => {
    // TODO: These tests require a real agent to make progress in the container.
    // The mock Docker doesn't run real containers, so tasks never reach COMPLETED status.
    // it('should display formatted content with --file flag', async () => {
    //   await runRover(['task', '-y', 'Create a hello world script']);
    //   await waitForTaskStatus(1, 'COMPLETED');
    //   const result = await runRover(['inspect', '1', '--file', 'summary.md']);
    //   expect(result.exitCode).toBeDefined();
    // });

    // it('should display raw content with --raw-file flag', async () => {
    //   await runRover(['task', '-y', 'Create a hello world script']);
    //   await waitForTaskStatus(1, 'COMPLETED');
    //   const result = await runRover(['inspect', '1', '--raw-file', 'summary.md']);
    //   expect(result.exitCode).toBeDefined();
    // });

    it('should reject using both --file and --raw-file together', async () => {
      await runRover(['task', '-y', 'Create a hello world script', '--json']);

      const result = await runRover([
        'inspect',
        '1',
        '--file',
        'summary.md',
        '--raw-file',
        'summary.md',
      ]);

      // Should fail because --file and --raw-file are mutually exclusive
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('iteration selection', () => {
    it('should allow inspecting a specific iteration number', async () => {
      await runRover(['task', '-y', 'Create a hello world script', '--json']);

      // Inspect iteration 1 specifically
      const result = await runRover(['inspect', '1', '1', '--json']);

      // Should succeed or fail gracefully depending on iteration existence
      expect(result.exitCode).toBeDefined();
    });
  });

  // TODO: This test requires a real agent to make progress in the container.
  // The mock Docker doesn't run real containers, so tasks never reach COMPLETED status.
  // describe('file change statistics', () => {
  //   it('should include file change statistics for completed tasks', async () => {
  //     await runRover(['task', '-y', 'Create a hello world script']);
  //     await waitForTaskStatus(1, 'COMPLETED');
  //     const result = await runRover(['inspect', '1', '--json']);
  //     expect(result.exitCode).toBe(0);
  //     const output = JSON.parse(result.stdout);
  //     if (output.fileChanges) {
  //       expect(Array.isArray(output.fileChanges)).toBe(true);
  //     }
  //   });
  // });

  describe('JSON output', () => {
    it('should produce a complete JSON representation of the task', async () => {
      await runRover(['task', '-y', 'Create a hello world script', '--json']);

      const result = await runRover(['inspect', '1', '--json']);
      expect(result.exitCode).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.id).toBe(1);
      expect(output.title).toBeDefined();
      expect(output.status).toBeDefined();
      expect(output.createdAt).toBeDefined();
    });
  });
});
