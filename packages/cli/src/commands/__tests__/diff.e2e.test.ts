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
 * E2E tests for `rover diff` command
 *
 * These tests run the actual rover CLI binary and test the full diff workflow.
 * They mock system tool availability by creating wrapper scripts in a temporary bin directory.
 */

describe('rover diff (e2e)', () => {
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

  const waitForTaskCompletion = async (
    taskId: number,
    timeoutMs: number = 600000
  ): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const result = await runRover(['inspect', String(taskId), '--json']);
      if (result.exitCode === 0) {
        const output = JSON.parse(result.stdout);
        if (output.status === 'COMPLETED' || output.status === 'FAILED') return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Timeout waiting for task ${taskId} to complete`);
  };

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalPath = process.env.PATH || '';

    testDir = mkdtempSync(join(tmpdir(), 'rover-diff-e2e-'));
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

  // TODO: These tests require a real agent to make progress in the container.
  // The mock Docker doesn't run real containers, so tasks never reach COMPLETED status.
  // describe('default diff', () => {
  //   it('should show changes in task worktree relative to source branch', async () => {
  //     await runRover(['task', '-y', 'Create a hello world bash script named hello.sh']);
  //     await waitForTaskCompletion(1);
  //     const result = await runRover(['diff', '1']);
  //     expect(result.exitCode).toBe(0);
  //   });
  // });

  // describe('base commit comparison', () => {
  //   it('should compare worktree state against base commit with --base flag', async () => {
  //     await runRover(['task', '-y', 'Create a hello world bash script named hello.sh']);
  //     await waitForTaskCompletion(1);
  //     const result = await runRover(['diff', '1', '--base']);
  //     expect(result.exitCode).toBe(0);
  //   });
  // });

  describe('branch comparison', () => {
    // TODO: This test requires a real agent to make progress in the container.
    // The mock Docker doesn't run real containers, so tasks never reach COMPLETED status.
    // it('should compare task worktree against a specified branch with --branch flag', async () => {
    //   await execa('git', ['add', '.'], { cwd: testDir });
    //   await execa('git', ['commit', '-m', 'Add rover config', '--allow-empty'], { cwd: testDir });
    //   await execa('git', ['branch', 'compare-branch'], { cwd: testDir });
    //   await runRover(['task', '-y', 'Create a hello world bash script named hello.sh']);
    //   await waitForTaskCompletion(1);
    //   const result = await runRover(['diff', '1', '--branch', 'compare-branch']);
    //   expect(result.exitCode).toBe(0);
    // });

    it('should error when both --base and --branch are provided', async () => {
      await runRover([
        'task',
        '-y',
        'Create a hello world bash script named hello.sh',
        '--json',
      ]);

      const result = await runRover([
        'diff',
        '1',
        '--base',
        '--branch',
        'some-branch',
      ]);

      // Should fail because --base and --branch are mutually exclusive
      expect(result.exitCode).not.toBe(0);
    });
  });

  // TODO: These tests require a real agent to make progress in the container.
  // The mock Docker doesn't run real containers, so tasks never reach COMPLETED status.
  // describe('file-specific diff', () => {
  //   it('should restrict diff output to a single file', async () => {
  //     await runRover(['task', '-y', 'Create a hello world bash script named hello.sh']);
  //     await waitForTaskCompletion(1);
  //     const result = await runRover(['diff', '1', 'hello.sh']);
  //     expect(result.exitCode).toBeDefined();
  //   });
  // });

  // describe('file list mode', () => {
  //   it('should display only changed file names with --only-files flag', async () => {
  //     await runRover(['task', '-y', 'Create a hello world bash script named hello.sh']);
  //     await waitForTaskCompletion(1);
  //     const result = await runRover(['diff', '1', '--only-files']);
  //     expect(result.exitCode).toBe(0);
  //   });
  // });
});
