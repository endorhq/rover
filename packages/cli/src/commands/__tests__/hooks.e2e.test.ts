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
 * E2E tests for Rover hooks system
 *
 * These tests run the actual rover CLI binary and test the hook execution workflow.
 * Hooks are configured in rover.json and execute shell commands when task lifecycle
 * events occur (onComplete, onMerge, onPush).
 */

describe('rover hooks (e2e)', () => {
  let testDir: string;
  let remoteDir: string;
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
  ): Promise<string> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const result = await runRover(['inspect', String(taskId), '--json']);
      if (result.exitCode === 0) {
        const output = JSON.parse(result.stdout);
        if (output.status === 'COMPLETED' || output.status === 'FAILED')
          return output.status;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Timeout waiting for task ${taskId} to complete`);
  };

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalPath = process.env.PATH || '';

    // Create a bare remote repository for push tests
    remoteDir = mkdtempSync(join(tmpdir(), 'rover-hooks-remote-'));
    await execa('git', ['init', '--bare', remoteDir]);

    testDir = mkdtempSync(join(tmpdir(), 'rover-hooks-e2e-'));
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

    // Add remote
    await execa('git', ['remote', 'add', 'origin', remoteDir], {
      cwd: testDir,
    });

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
    await execa('git', ['push', '-u', 'origin', 'master'], {
      cwd: testDir,
    }).catch(() =>
      execa('git', ['push', '-u', 'origin', 'main'], { cwd: testDir })
    );

    await runRover(['init', '--yes']);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    rmSync(testDir, { recursive: true, force: true });
    rmSync(remoteDir, { recursive: true, force: true });
  });

  // TODO: All hooks tests require a real agent to make progress in the container.
  // The mock Docker doesn't run real containers, so tasks never reach COMPLETED status.

  // describe('onComplete hook', () => {
  //   it('should execute onComplete hook when task reaches terminal status via rover list', ...);
  //   it('should receive ROVER_TASK_ID, ROVER_TASK_BRANCH, ROVER_TASK_TITLE, and ROVER_TASK_STATUS', ...);
  // });

  // describe('onMerge hook', () => {
  //   it('should execute onMerge hook after successful merge', ...);
  //   it('should receive ROVER_TASK_ID, ROVER_TASK_BRANCH, and ROVER_TASK_TITLE', ...);
  // });

  // describe('onPush hook', () => {
  //   it('should execute onPush hook after successful push', ...);
  //   it('should receive ROVER_TASK_ID, ROVER_TASK_BRANCH, and ROVER_TASK_TITLE', ...);
  // });

  // describe('hook failure isolation', () => {
  //   it('should not block the operation when a hook command fails', ...);
  // });

  // describe('multiple hook commands', () => {
  //   it('should execute all commands in the hook array', ...);
  // });
});
