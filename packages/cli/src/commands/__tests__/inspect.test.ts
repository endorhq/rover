import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  launchSync,
  clearProjectRootCache,
  TaskDescriptionManager,
  IterationManager,
} from 'rover-core';
import { inspectCommand } from '../inspect.js';
import { isStdoutTTY } from '../../utils/stdout.js';

// Store testDir for context mock
let testDir: string;

// Track JSON mode state
let mockJsonMode = false;

// Mock context to return a mock ProjectManager
vi.mock('../../lib/context.js', () => ({
  requireProjectContext: vi.fn().mockImplementation(() => {
    return Promise.resolve({
      path: testDir,
      getTask: (taskId: number) => {
        const taskPath = join(testDir, '.rover', 'tasks', taskId.toString());
        if (TaskDescriptionManager.exists(taskPath)) {
          return TaskDescriptionManager.load(taskPath, taskId);
        }
        return undefined;
      },
    });
  }),
  isJsonMode: () => mockJsonMode,
  setJsonMode: (value: boolean) => {
    mockJsonMode = value;
  },
}));

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventInspectTask: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock display utilities to suppress output during tests
vi.mock('../../utils/display.js', () => ({
  showTips: vi.fn(),
}));

// Mock stdout TTY detection so we can test piped vs interactive behavior
vi.mock('../../utils/stdout.js', () => ({
  isStdoutTTY: vi.fn(() => true),
}));

describe('inspect command', () => {
  let originalCwd: string;
  // biome-ignore lint/suspicious/noExplicitAny: process.exit mock type requires flexible typing
  let processExitSpy: any;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let capturedOutput: string[];

  beforeEach(() => {
    // Mock process.exit to prevent test from exiting
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as any);

    // Clear project root cache to ensure tests use the correct directory
    clearProjectRootCache();

    // Create temp directory with git repo
    testDir = mkdtempSync(join(tmpdir(), 'rover-inspect-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize git repo
    launchSync('git', ['init']);
    launchSync('git', ['config', 'user.email', 'test@test.com']);
    launchSync('git', ['config', 'user.name', 'Test User']);
    launchSync('git', ['config', 'commit.gpgsign', 'false']);

    // Create initial commit
    writeFileSync('README.md', '# Test Project\n');
    launchSync('git', ['add', '.']);
    launchSync('git', ['commit', '-m', 'Initial commit']);

    // Create .rover directory structure
    mkdirSync('.rover/tasks', { recursive: true });

    // Create rover.json to indicate this is a Rover project
    writeFileSync(
      'rover.json',
      JSON.stringify({
        version: '1.2',
        languages: [],
        mcps: [],
        packageManagers: [],
        taskManagers: [],
        attribution: true,
      })
    );

    // Capture console output
    capturedOutput = [];
    consoleLogSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((msg: string) => {
        capturedOutput.push(String(msg));
      });

    // Reset JSON mode
    mockJsonMode = false;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    vi.clearAllMocks();
    clearProjectRootCache();
    mockJsonMode = false;
  });

  // Helper to create a test task with a worktree
  const createTestTask = (id: number, title: string = 'Test Task') => {
    const taskPath = join(testDir, '.rover', 'tasks', id.toString());
    const task = TaskDescriptionManager.create(taskPath, {
      id,
      title,
      description: 'Test task description',
      inputs: new Map(),
      workflowName: 'swe',
    });

    // Create a git worktree for the task
    const worktreePath = join('.rover', 'tasks', id.toString(), 'workspace');
    const branchName = `rover-task-${id}`;

    launchSync('git', ['worktree', 'add', worktreePath, '-b', branchName]);
    task.setWorkspace(join(testDir, worktreePath), branchName);

    // Create iteration with proper iteration.json
    const iterationPath = join(taskPath, 'iterations', '1');
    mkdirSync(iterationPath, { recursive: true });
    IterationManager.createInitial(
      iterationPath,
      id,
      title,
      'Test task description'
    );
    writeFileSync(join(iterationPath, 'summary.md'), '# Test Summary\n');

    // Update task status
    task.markInProgress();
    task.markCompleted();

    return { task, worktreePath, branchName };
  };

  describe('Task validation', () => {
    it('should reject non-numeric task ID', async () => {
      await inspectCommand('invalid');

      const output = capturedOutput.join('\n');
      expect(output).toContain("Invalid task ID 'invalid' - must be a number");
    });

    it('should handle non-existent task', async () => {
      await inspectCommand('999');

      const output = capturedOutput.join('\n');
      expect(output).toContain('Task 999 not found');
    });
  });

  describe('JSON output', () => {
    it('should output exactly one valid JSON object when using --json flag', async () => {
      createTestTask(1, 'Test Task for JSON');

      await inspectCommand('1', undefined, { json: true });

      // Filter to only JSON outputs (skip any non-JSON lines)
      const jsonOutputs = capturedOutput.filter(line => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });

      // Should have exactly one JSON output
      expect(jsonOutputs.length).toBe(1);

      // Parse and verify the JSON structure
      const parsed = JSON.parse(jsonOutputs[0]);
      expect(parsed.success).toBe(true);
      expect(parsed.id).toBe(1);
      expect(parsed.title).toBe('Test Task for JSON');
    });

    it('should include all expected fields in JSON output', async () => {
      createTestTask(1, 'Complete Task');

      await inspectCommand('1', undefined, { json: true });

      const jsonOutput = capturedOutput.find(line => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput!);

      // Verify expected fields are present
      expect(parsed).toHaveProperty('success');
      expect(parsed).toHaveProperty('id');
      expect(parsed).toHaveProperty('title');
      expect(parsed).toHaveProperty('description');
      expect(parsed).toHaveProperty('status');
      expect(parsed).toHaveProperty('branchName');
      expect(parsed).toHaveProperty('worktreePath');
      expect(parsed).toHaveProperty('workflowName');
    });

    it('should output error as single JSON object for invalid task ID', async () => {
      await inspectCommand('invalid', undefined, { json: true });

      const jsonOutputs = capturedOutput.filter(line => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });

      // Should have exactly one JSON output even for errors
      expect(jsonOutputs.length).toBe(1);

      const parsed = JSON.parse(jsonOutputs[0]);
      expect(parsed.success).toBe(false);
      // Error output has 'errors' array from exitWithError
      expect(parsed.errors).toBeDefined();
      expect(parsed.errors[0]).toContain('Invalid task ID');
    });

    it('should output error as single JSON object for non-existent task', async () => {
      await inspectCommand('999', undefined, { json: true });

      const jsonOutputs = capturedOutput.filter(line => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });

      // Should have exactly one JSON output even for errors
      expect(jsonOutputs.length).toBe(1);

      const parsed = JSON.parse(jsonOutputs[0]);
      expect(parsed.success).toBe(false);
    });
  });

  describe('Agent display', () => {
    it('should show agent:model in human-readable output', async () => {
      const { task } = createTestTask(1, 'Agent Task');
      task.setAgent('claude', 'opus');

      await inspectCommand('1');

      const output = capturedOutput.join('\n');
      expect(output).toContain('claude:opus');
    });

    it('should show agent without model in human-readable output', async () => {
      const { task } = createTestTask(1, 'Agent Task');
      task.setAgent('gemini');

      await inspectCommand('1');

      const output = capturedOutput.join('\n');
      expect(output).toContain('gemini');
    });

    it('should show dash when no agent is set in human-readable output', async () => {
      createTestTask(1, 'No Agent Task');

      await inspectCommand('1');

      const output = capturedOutput.join('\n');
      // The Agent row should show '-'
      expect(output).toMatch(/Agent.*-/);
    });

    it('should include agent fields in JSON output', async () => {
      const { task } = createTestTask(1, 'Agent JSON Task');
      task.setAgent('claude', 'opus');

      await inspectCommand('1', undefined, { json: true });

      const jsonOutput = capturedOutput.find(line => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });

      const parsed = JSON.parse(jsonOutput!);
      expect(parsed.agent).toBe('claude');
      expect(parsed.agentModel).toBe('opus');
      expect(parsed.agentDisplay).toBe('claude:opus');
    });

    it('should have undefined agent fields in JSON when no agent set', async () => {
      createTestTask(1, 'No Agent JSON Task');

      await inspectCommand('1', undefined, { json: true });

      const jsonOutput = capturedOutput.find(line => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });

      const parsed = JSON.parse(jsonOutput!);
      expect(parsed.agent).toBeUndefined();
      expect(parsed.agentModel).toBeUndefined();
      expect(parsed.agentDisplay).toBeUndefined();
    });
  });

  describe('Standard output', () => {
    it('should display task details in human-readable format', async () => {
      createTestTask(1, 'Human Readable Task');

      await inspectCommand('1');

      const output = capturedOutput.join('\n');
      expect(output).toContain('Human Readable Task');
      expect(output).toContain('Details');
    });
  });

  describe('Piped stdout (content-only output)', () => {
    it('should output only raw file content when stdout is piped', async () => {
      createTestTask(1, 'Piped Task');
      vi.mocked(isStdoutTTY).mockReturnValue(false);

      await inspectCommand('1');

      const output = capturedOutput.join('\n');
      // Should contain the raw file content (summary.md from createTestTask)
      expect(output).toContain('# Test Summary');
      // Should not contain decorated output
      expect(output).not.toContain('Details');
      expect(output).not.toContain('Workspace');
      expect(output).not.toContain('Workflow Output');
      // Should not contain box-drawing characters from showFile
      expect(output).not.toMatch(/┌|└|│/);

      vi.mocked(isStdoutTTY).mockReturnValue(true);
    });

    it('should output nothing when stdout is piped and task has no iteration files', async () => {
      const taskPath = join(testDir, '.rover', 'tasks', '2');
      const task = TaskDescriptionManager.create(taskPath, {
        id: 2,
        title: 'Empty Task',
        description: 'No iterations',
        inputs: new Map(),
        workflowName: 'swe',
      });
      const worktreePath = join('.rover', 'tasks', '2', 'workspace');
      launchSync('git', [
        'worktree',
        'add',
        worktreePath,
        '-b',
        'rover-task-2',
      ]);
      task.setWorkspace(join(testDir, worktreePath), 'rover-task-2');
      task.markInProgress();
      task.markCompleted();
      // No iteration directory with markdown files

      vi.mocked(isStdoutTTY).mockReturnValue(false);

      await inspectCommand('2');

      const output = capturedOutput.join('\n');
      expect(output).not.toContain('Details');
      expect(output).not.toContain('Workspace');

      vi.mocked(isStdoutTTY).mockReturnValue(true);
    });
  });
});
