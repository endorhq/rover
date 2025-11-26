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
import { clearProjectRootCache, launchSync } from 'rover-common';
import { stopCommand } from '../stop.js';
import { TaskDescriptionManager } from 'rover-schemas';

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventStopTask: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock exit utilities to prevent process.exit
vi.mock('../../utils/exit.js', () => ({
  exitWithError: vi.fn().mockImplementation(() => {}),
  exitWithSuccess: vi.fn().mockImplementation(() => {}),
}));

// Mock sandbox to prevent actual Docker/Podman calls
vi.mock('../../lib/sandbox/index.js', () => ({
  createSandbox: vi.fn().mockResolvedValue({
    stopAndRemove: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('stop command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory with git repo
    testDir = mkdtempSync(join(tmpdir(), 'rover-stop-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize git repo
    launchSync('git', ['init']);
    launchSync('git', ['config', 'user.email', 'test@test.com']);
    launchSync('git', ['config', 'user.name', 'Test User']);
    launchSync('git', ['config', 'commit.gpgsign', 'false']);

    // Create initial commit
    writeFileSync('README.md', '# Test');
    launchSync('git', ['add', '.']);
    launchSync('git', ['commit', '-m', 'Initial commit']);

    // Create .rover directory structure
    mkdirSync('.rover/tasks', { recursive: true });

    // Create rover.json to indicate this is a Rover project
    writeFileSync(
      join(testDir, 'rover.json'),
      JSON.stringify({ name: 'test-project' })
    );

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
    clearProjectRootCache();
  });

  // Helper to create a test task
  const createTestTask = (id: number, title: string = 'Test Task') => {
    const task = TaskDescriptionManager.create({
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

    return task;
  };

  describe('Task ID validation', () => {
    it('should reject non-numeric task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await stopCommand('invalid', { json: true });

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Invalid task ID'),
        }),
        expect.objectContaining({
          telemetry: expect.anything(),
        })
      );
    });

    it('should handle non-existent task', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await stopCommand('999', { json: true });

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('not found'),
        }),
        expect.objectContaining({
          telemetry: expect.anything(),
        })
      );
    });
  });

  describe('Task status after stop', () => {
    it('should reset task to NEW status and clear container info', async () => {
      // This is the key test for the fix in this branch
      const task = createTestTask(1, 'In Progress Task');

      // Set task to IN_PROGRESS with container info
      task.markInProgress();
      task.setContainerInfo('container-123', 'container-name');
      expect(task.status).toBe('IN_PROGRESS');
      expect(task.containerId).toBe('container-123');

      // Stop the task
      await stopCommand('1', { json: true });

      // Verify task was reset to NEW and container info cleared
      const reloadedTask = TaskDescriptionManager.load(1);
      expect(reloadedTask.status).toBe('NEW');
      expect(reloadedTask.containerId).toBe('');
    });

    it('should reset FAILED task to NEW status', async () => {
      const task = createTestTask(2, 'Failed Task');

      // Set task to FAILED status
      task.markFailed('Test failure');
      expect(task.status).toBe('FAILED');

      // Stop the task
      await stopCommand('2', { json: true });

      // Verify task was reset to NEW
      const reloadedTask = TaskDescriptionManager.load(2);
      expect(reloadedTask.status).toBe('NEW');
    });

    it('should allow restart after stop (status should be NEW)', async () => {
      const task = createTestTask(3, 'Restartable Task');

      // Set task to IN_PROGRESS
      task.markInProgress();
      task.setContainerInfo('container-456', 'container-name-456');

      // Stop the task
      await stopCommand('3', { json: true });

      // Verify task is in NEW status and can be restarted
      const reloadedTask = TaskDescriptionManager.load(3);
      expect(reloadedTask.status).toBe('NEW');

      // The task should be able to transition to IN_PROGRESS again
      reloadedTask.markInProgress();
      expect(reloadedTask.status).toBe('IN_PROGRESS');
    });
  });

  describe('Container cleanup', () => {
    it('should stop and remove container if it exists', async () => {
      const { createSandbox } = await import('../../lib/sandbox/index.js');
      const task = createTestTask(4, 'Task with Container');

      // Set container info
      task.setContainerInfo('container-789', 'container-name-789');
      task.markInProgress();

      await stopCommand('4', { json: true });

      // Verify sandbox was created and stopAndRemove was called
      expect(createSandbox).toHaveBeenCalled();
      const sandbox = await createSandbox(task, undefined);
      expect(sandbox.stopAndRemove).toHaveBeenCalled();
    });

    it('should handle task without container', async () => {
      const { createSandbox } = await import('../../lib/sandbox/index.js');
      const task = createTestTask(5, 'Task without Container');

      // Don't set container info
      task.markInProgress();

      await stopCommand('5', { json: true });

      // Verify sandbox was not created since there's no container
      expect(createSandbox).not.toHaveBeenCalled();
    });
  });

  describe('Workspace cleanup', () => {
    it('should clear workspace information', async () => {
      const task = createTestTask(6, 'Task with Workspace');
      expect(task.worktreePath).toBeTruthy();
      expect(task.branchName).toBeTruthy();

      await stopCommand('6', { json: true });

      const reloadedTask = TaskDescriptionManager.load(6);
      expect(reloadedTask.worktreePath).toBe('');
      expect(reloadedTask.branchName).toBe('');
    });

    it('should not remove git worktree and branch by default', async () => {
      const task = createTestTask(7, 'Default Stop Task');
      const worktreePath = join('.rover', 'tasks', '7', 'workspace');
      const branchName = 'rover-task-7';

      await stopCommand('7', { json: true });

      // Worktree and branch should still exist
      expect(existsSync(worktreePath)).toBe(true);
      const branches = launchSync('git', ['branch']).stdout;
      expect(branches).toContain(branchName);
    });

    it('should remove git worktree and branch with removeAll option', async () => {
      const task = createTestTask(8, 'Remove All Task');
      const worktreePath = join('.rover', 'tasks', '8', 'workspace');
      const branchName = 'rover-task-8';

      await stopCommand('8', { json: true, removeAll: true });

      // Worktree and branch should be removed
      expect(existsSync(worktreePath)).toBe(false);
      const branches = launchSync('git', ['branch']).stdout;
      expect(branches).not.toContain(branchName);
    });

    it('should remove git worktree and branch with removeGitWorktreeAndBranch option', async () => {
      const task = createTestTask(9, 'Remove Git Task');
      const worktreePath = join('.rover', 'tasks', '9', 'workspace');
      const branchName = 'rover-task-9';

      await stopCommand('9', {
        json: true,
        removeGitWorktreeAndBranch: true,
      });

      // Worktree and branch should be removed
      expect(existsSync(worktreePath)).toBe(false);
      const branches = launchSync('git', ['branch']).stdout;
      expect(branches).not.toContain(branchName);
    });
  });

  describe('Iterations cleanup', () => {
    it('should delete iterations directory', async () => {
      const task = createTestTask(10, 'Task with Iterations');

      // Create iterations directory with content
      const iterationsDir = join('.rover', 'tasks', '10', 'iterations', '1');
      mkdirSync(iterationsDir, { recursive: true });
      writeFileSync(join(iterationsDir, 'context.md'), '# Context');
      writeFileSync(join(iterationsDir, 'plan.md'), '# Plan');

      expect(existsSync(iterationsDir)).toBe(true);

      await stopCommand('10', { json: true });

      // Iterations directory should be deleted
      const iterationsPath = join('.rover', 'tasks', '10', 'iterations');
      expect(existsSync(iterationsPath)).toBe(false);
    });
  });

  describe('Telemetry integration', () => {
    it('should call telemetry on stop', async () => {
      const { getTelemetry } = await import('../../lib/telemetry.js');
      const mockTelemetry = getTelemetry();

      const task = createTestTask(11, 'Telemetry Task');

      await stopCommand('11', { json: true });

      expect(mockTelemetry?.eventStopTask).toHaveBeenCalled();
      expect(mockTelemetry?.shutdown).toHaveBeenCalled();
    });

    it('should call telemetry shutdown even on failure', async () => {
      const { getTelemetry } = await import('../../lib/telemetry.js');
      const mockTelemetry = getTelemetry();

      await stopCommand('999', { json: true });

      expect(mockTelemetry?.shutdown).toHaveBeenCalled();
    });
  });

  describe('Success output', () => {
    it('should return success with task details', async () => {
      const { exitWithSuccess } = await import('../../utils/exit.js');
      const task = createTestTask(12, 'Success Task');

      await stopCommand('12', { json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'Task stopped successfully!',
        expect.objectContaining({
          success: true,
          taskId: 12,
          title: 'Success Task',
          status: 'NEW',
          stoppedAt: expect.any(String),
        }),
        expect.objectContaining({
          tips: expect.arrayContaining([
            expect.stringContaining('rover logs 12'),
            expect.stringContaining('rover restart 12'),
            expect.stringContaining('rover delete 12'),
          ]),
          telemetry: expect.anything(),
        })
      );
    });
  });
});
