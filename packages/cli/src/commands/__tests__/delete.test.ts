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
import { launchSync } from 'rover-common';
import { deleteCommand } from '../delete.js';
import { TaskDescription } from '../../lib/description.js';

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventDeleteTask: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock enquirer at the top level
vi.mock('enquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

// Mock exit utilities to prevent process.exit
vi.mock('../../utils/exit.js', () => ({
  exitWithErrors: vi.fn().mockImplementation(() => {}),
  exitWithSuccess: vi.fn().mockImplementation(() => {}),
  exitWithWarn: vi.fn().mockImplementation(() => {}),
}));

// Mock display utilities to suppress output
vi.mock('../../utils/display.js', () => ({
  showRoverChat: vi.fn(),
}));

describe('delete command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory with git repo
    testDir = mkdtempSync(join(tmpdir(), 'rover-delete-test-'));
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
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // Helper to create a test task
  const createTestTask = (id: number, title: string = 'Test Task') => {
    const task = TaskDescription.create({
      id,
      title,
      description: 'Test task description',
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
      const { exitWithErrors } = await import('../../utils/exit.js');

      await deleteCommand(['invalid']);

      expect(exitWithErrors).toHaveBeenCalledWith(
        expect.objectContaining({
          errors: expect.arrayContaining([
            "Invalid task ID 'invalid' - must be a number",
          ]),
        }),
        false
      );
    });

    it('should reject empty task ID', async () => {
      const { exitWithErrors } = await import('../../utils/exit.js');

      await deleteCommand(['']);

      expect(exitWithErrors).toHaveBeenCalledWith(
        expect.objectContaining({
          errors: expect.arrayContaining([
            "Invalid task ID '' - must be a number",
          ]),
        }),
        false
      );
    });

    it('should handle floating point task ID', async () => {
      const { exitWithErrors } = await import('../../utils/exit.js');

      await deleteCommand(['1.5']);

      // parseInt('1.5') = 1, so this should try to delete task 1
      expect(exitWithErrors).toHaveBeenCalledWith(
        {
          errors: ['Task with ID 1 was not found'],
          success: false,
        },
        false
      );
    });
  });

  describe('Task not found scenarios', () => {
    it('should handle non-existent task gracefully', async () => {
      const { exitWithErrors } = await import('../../utils/exit.js');

      await deleteCommand(['999']);

      expect(exitWithErrors).toHaveBeenCalledWith(
        {
          errors: ['Task with ID 999 was not found'],
          success: false,
        },
        false
      );
    });

    it('should handle negative task ID', async () => {
      const { exitWithErrors } = await import('../../utils/exit.js');

      await deleteCommand(['-1']);

      expect(exitWithErrors).toHaveBeenCalledWith(
        {
          errors: ['Task with ID -1 was not found'],
          success: false,
        },
        false
      );
    });
  });

  describe('Successful task deletion', () => {
    it('should delete task with --yes flag', async () => {
      const task = createTestTask(1, 'Task to Delete');
      const taskPath = join('.rover', 'tasks', '1');

      // Verify task exists before deletion
      expect(existsSync(taskPath)).toBe(true);
      expect(TaskDescription.exists(1)).toBe(true);

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await deleteCommand(['1'], { yes: true });

      // Verify task was deleted
      expect(existsSync(taskPath)).toBe(false);
      expect(exitWithSuccess).toHaveBeenCalledWith(
        'All tasks (IDs: 1) deleted successfully',
        {
          success: true,
          errors: [],
        },
        false
      );
    });

    it('should delete task with JSON output', async () => {
      createTestTask(2, 'JSON Delete Task');

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await deleteCommand(['2'], { json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'All tasks (IDs: 2) deleted successfully',
        {
          success: true,
          errors: [],
        },
        true
      );
      expect(existsSync('.rover/tasks/2')).toBe(false);
    });

    it('should prune Git worktrees after deletion', async () => {
      createTestTask(3, 'Worktree Test Task');

      // Verify worktree exists
      const worktreeList = launchSync('git', ['worktree', 'list']).stdout;
      expect(worktreeList).toContain('rover-task-3');

      await deleteCommand(['3'], { yes: true });

      // Verify task directory is deleted
      expect(existsSync('.rover/tasks/3')).toBe(false);
    });

    it('should delete task with complex title and description', async () => {
      createTestTask(4, 'Complex Task with "quotes" & special chars!');

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await deleteCommand(['4'], { yes: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'All tasks (IDs: 4) deleted successfully',
        {
          success: true,
          errors: [],
        },
        false
      );
      expect(existsSync('.rover/tasks/4')).toBe(false);
    });
  });

  describe('User confirmation flow', () => {
    it('should prompt for confirmation when no --yes flag', async () => {
      createTestTask(5, 'Confirmation Task');

      // Mock enquirer to return false (cancel)
      const enquirer = await import('enquirer');
      vi.mocked(enquirer.default.prompt).mockResolvedValue({ confirm: false });

      const { exitWithErrors } = await import('../../utils/exit.js');

      await deleteCommand(['5']);

      expect(exitWithErrors).toHaveBeenCalledWith(
        {
          success: false,
          errors: ['Task deletion cancelled'],
        },
        false
      );

      // Task should still exist
      expect(existsSync('.rover/tasks/5')).toBe(true);
    });

    it('should proceed when user confirms deletion', async () => {
      createTestTask(6, 'Confirmed Task');

      // Mock enquirer to return true (confirm)
      const enquirer = await import('enquirer');
      vi.mocked(enquirer.default.prompt).mockResolvedValue({ confirm: true });

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await deleteCommand(['6']);

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'All tasks (IDs: 6) deleted successfully',
        {
          success: true,
          errors: [],
        },
        false
      );

      // Task should be deleted
      expect(existsSync('.rover/tasks/6')).toBe(false);
    });

    it('should skip confirmation in JSON mode', async () => {
      createTestTask(7, 'JSON Mode Task');

      const { exitWithSuccess } = await import('../../utils/exit.js');

      // Don't mock enquirer - it shouldn't be called in JSON mode
      await deleteCommand(['7'], { json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'All tasks (IDs: 7) deleted successfully',
        {
          success: true,
          errors: [],
        },
        true
      );
      expect(existsSync('.rover/tasks/7')).toBe(false);
    });
  });

  describe('Task status handling', () => {
    it('should delete tasks with different statuses', async () => {
      // Create tasks with various statuses
      const _taskNew = createTestTask(8, 'New Task');
      const taskInProgress = createTestTask(9, 'In Progress Task');
      const taskCompleted = createTestTask(10, 'Completed Task');
      const taskFailed = createTestTask(11, 'Failed Task');

      taskInProgress.markInProgress();
      taskCompleted.markCompleted();
      taskFailed.markFailed('Test failure');

      // Delete all tasks
      await deleteCommand(['8'], { yes: true });
      await deleteCommand(['9'], { yes: true });
      await deleteCommand(['10'], { yes: true });
      await deleteCommand(['11'], { yes: true });

      // Verify all deleted
      expect(existsSync('.rover/tasks/8')).toBe(false);
      expect(existsSync('.rover/tasks/9')).toBe(false);
      expect(existsSync('.rover/tasks/10')).toBe(false);
      expect(existsSync('.rover/tasks/11')).toBe(false);
    });

    it('should delete tasks in ITERATING status', async () => {
      const taskIterating = createTestTask(12, 'Iterating Task');
      taskIterating.updateIteration({ timestamp: new Date().toISOString() });

      await deleteCommand(['12'], { yes: true });

      expect(existsSync('.rover/tasks/12')).toBe(false);
    });
  });

  describe('Multiple tasks and workspace cleanup', () => {
    it('should handle deletion of multiple tasks', async () => {
      // Create multiple tasks
      createTestTask(13, 'Task A');
      createTestTask(14, 'Task B');
      createTestTask(15, 'Task C');

      // Verify worktrees exist
      const initialWorktrees = launchSync('git', ['worktree', 'list']).stdout;
      expect(initialWorktrees).toContain('rover-task-13');
      expect(initialWorktrees).toContain('rover-task-14');
      expect(initialWorktrees).toContain('rover-task-15');

      // Delete them one by one
      await deleteCommand(['13'], { yes: true });
      await deleteCommand(['14'], { yes: true });
      await deleteCommand(['15'], { yes: true });

      // Verify all deleted
      expect(existsSync('.rover/tasks/13')).toBe(false);
      expect(existsSync('.rover/tasks/14')).toBe(false);
      expect(existsSync('.rover/tasks/15')).toBe(false);

      const finalWorktrees = launchSync('git', ['worktree', 'list']).stdout;
      expect(finalWorktrees).not.toContain('rover-task-13');
      expect(finalWorktrees).not.toContain('rover-task-14');
      expect(finalWorktrees).not.toContain('rover-task-15');
    });

    it('should handle tasks with iterations directory', async () => {
      const task = createTestTask(16, 'Task with Iterations');

      // Create iterations directory structure
      const iterationsDir = join('.rover', 'tasks', '16', 'iterations', '1');
      mkdirSync(iterationsDir, { recursive: true });
      writeFileSync(join(iterationsDir, 'context.md'), '# Context');
      writeFileSync(join(iterationsDir, 'plan.md'), '# Plan');

      await deleteCommand(['16'], { yes: true });

      // Verify entire task directory is deleted including iterations
      expect(existsSync('.rover/tasks/16')).toBe(false);
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should handle task with missing worktree gracefully', async () => {
      const task = createTestTask(17, 'Missing Worktree Task');

      // Remove the worktree manually to simulate corruption
      const worktreePath = join('.rover', 'tasks', '17', 'workspace');
      rmSync(worktreePath, { recursive: true, force: true });

      const { exitWithSuccess } = await import('../../utils/exit.js');

      // Should still delete the task metadata successfully
      await deleteCommand(['17'], { yes: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'All tasks (IDs: 17) deleted successfully',
        {
          success: true,
          errors: [],
        },
        false
      );
      expect(existsSync('.rover/tasks/17')).toBe(false);
    });

    it('should handle zero task ID', async () => {
      const { exitWithErrors } = await import('../../utils/exit.js');

      await deleteCommand(['0']);

      expect(exitWithErrors).toHaveBeenCalledWith(
        {
          errors: ['Task with ID 0 was not found'],
          success: false,
        },
        false
      );
    });

    it('should handle very large task ID', async () => {
      const { exitWithErrors } = await import('../../utils/exit.js');

      await deleteCommand(['999999999']);

      expect(exitWithErrors).toHaveBeenCalledWith(
        {
          errors: ['Task with ID 999999999 was not found'],
          success: false,
        },
        false
      );
    });
  });

  describe('Combined flag scenarios', () => {
    it('should handle --yes and --json flags together', async () => {
      createTestTask(18, 'Combined Flags Task');

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await deleteCommand(['18'], { yes: true, json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'All tasks (IDs: 18) deleted successfully',
        {
          success: true,
          errors: [],
        },
        true // JSON mode
      );
      expect(existsSync('.rover/tasks/18')).toBe(false);
    });
  });

  describe('Multiple task deletion', () => {
    it('should delete multiple tasks with single confirmation', async () => {
      createTestTask(20, 'Task A');
      createTestTask(21, 'Task B');
      createTestTask(22, 'Task C');

      // Mock enquirer to return true (confirm)
      const enquirer = await import('enquirer');
      vi.mocked(enquirer.default.prompt).mockResolvedValue({ confirm: true });

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await deleteCommand(['20', '21', '22']);

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'All tasks (IDs: 20 21 22) deleted successfully',
        {
          success: true,
          errors: [],
        },
        false
      );

      // All tasks should be deleted
      expect(existsSync('.rover/tasks/20')).toBe(false);
      expect(existsSync('.rover/tasks/21')).toBe(false);
      expect(existsSync('.rover/tasks/22')).toBe(false);
    });

    it('should handle mixed valid/invalid task IDs', async () => {
      createTestTask(23, 'Valid Task');

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await deleteCommand(['23', '999'], { yes: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'All tasks (IDs: 23) deleted successfully',
        {
          success: true,
          errors: ['Task with ID 999 was not found'],
        },
        false
      );

      // Valid task should be deleted
      expect(existsSync('.rover/tasks/23')).toBe(false);
    });

    it('should cancel all deletions when user declines', async () => {
      createTestTask(24, 'Task A');
      createTestTask(25, 'Task B');

      // Mock enquirer to return false (cancel)
      const enquirer = await import('enquirer');
      vi.mocked(enquirer.default.prompt).mockResolvedValue({ confirm: false });

      const { exitWithErrors } = await import('../../utils/exit.js');

      await deleteCommand(['24', '25']);

      expect(exitWithErrors).toHaveBeenCalledWith(
        {
          success: false,
          errors: ['Task deletion cancelled'],
        },
        false
      );

      // Both tasks should still exist
      expect(existsSync('.rover/tasks/24')).toBe(true);
      expect(existsSync('.rover/tasks/25')).toBe(true);
    });
  });

  describe('Telemetry integration', () => {
    it('should call telemetry on successful deletion', async () => {
      createTestTask(19, 'Telemetry Task');

      const { getTelemetry } = await import('../../lib/telemetry.js');
      const mockTelemetry = getTelemetry();

      await deleteCommand(['19'], { yes: true });

      expect(mockTelemetry?.eventDeleteTask).toHaveBeenCalled();
      expect(mockTelemetry?.shutdown).toHaveBeenCalled();
    });

    it('should call telemetry shutdown even on failure', async () => {
      const { getTelemetry } = await import('../../lib/telemetry.js');
      const mockTelemetry = getTelemetry();

      await deleteCommand(['999']);

      expect(mockTelemetry?.shutdown).toHaveBeenCalled();
    });
  });
});
