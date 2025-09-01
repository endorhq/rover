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
import { execSync } from 'node:child_process';
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
  exitWithError: vi.fn().mockImplementation(() => {}),
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
    execSync('git init', { stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { stdio: 'pipe' });
    execSync('git config user.name "Test User"', { stdio: 'pipe' });
    execSync('git config commit.gpgsign false', { stdio: 'pipe' });

    // Create initial commit
    writeFileSync('README.md', '# Test');
    execSync('git add .', { stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { stdio: 'pipe' });

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

    execSync(`git worktree add ${worktreePath} -b ${branchName}`, {
      stdio: 'pipe',
    });
    task.setWorkspace(join(testDir, worktreePath), branchName);

    return task;
  };

  describe('Task ID validation', () => {
    it('should reject non-numeric task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await deleteCommand('invalid');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid task ID 'invalid' - must be a number",
        }),
        false
      );
    });

    it('should reject empty task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await deleteCommand('');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid task ID '' - must be a number",
        }),
        false
      );
    });

    it('should handle floating point task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await deleteCommand('1.5');

      // parseInt('1.5') = 1, so this should try to delete task 1
      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'The task with ID 1 was not found',
        }),
        false
      );
    });
  });

  describe('Task not found scenarios', () => {
    it('should handle non-existent task gracefully', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await deleteCommand('999');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'The task with ID 999 was not found',
        }),
        false
      );
    });

    it('should handle negative task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await deleteCommand('-1');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'The task with ID -1 was not found',
        }),
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

      await deleteCommand('1', { yes: true });

      // Verify task was deleted
      expect(existsSync(taskPath)).toBe(false);
      expect(exitWithSuccess).toHaveBeenCalledWith(
        'Task deleted successfully!',
        expect.objectContaining({ success: true }),
        false
      );
    });

    it('should delete task with JSON output', async () => {
      createTestTask(2, 'JSON Delete Task');

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await deleteCommand('2', { json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'Task deleted successfully!',
        expect.objectContaining({ success: true }),
        true
      );
      expect(existsSync('.rover/tasks/2')).toBe(false);
    });

    it('should prune Git worktrees after deletion', async () => {
      createTestTask(3, 'Worktree Test Task');

      // Verify worktree exists
      const worktreeList = execSync('git worktree list').toString();
      expect(worktreeList).toContain('rover-task-3');

      await deleteCommand('3', { yes: true });

      // Verify task directory is deleted
      expect(existsSync('.rover/tasks/3')).toBe(false);
    });

    it('should delete task with complex title and description', async () => {
      createTestTask(4, 'Complex Task with "quotes" & special chars!');

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await deleteCommand('4', { yes: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'Task deleted successfully!',
        expect.objectContaining({ success: true }),
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

      const { exitWithWarn } = await import('../../utils/exit.js');

      await deleteCommand('5');

      expect(exitWithWarn).toHaveBeenCalledWith(
        'Task deletion cancelled',
        expect.objectContaining({ success: false }),
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

      await deleteCommand('6');

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'Task deleted successfully!',
        expect.objectContaining({ success: true }),
        false
      );

      // Task should be deleted
      expect(existsSync('.rover/tasks/6')).toBe(false);
    });

    it('should skip confirmation in JSON mode', async () => {
      createTestTask(7, 'JSON Mode Task');

      const { exitWithSuccess } = await import('../../utils/exit.js');

      // Don't mock enquirer - it shouldn't be called in JSON mode
      await deleteCommand('7', { json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'Task deleted successfully!',
        expect.objectContaining({ success: true }),
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
      await deleteCommand('8', { yes: true });
      await deleteCommand('9', { yes: true });
      await deleteCommand('10', { yes: true });
      await deleteCommand('11', { yes: true });

      // Verify all deleted
      expect(existsSync('.rover/tasks/8')).toBe(false);
      expect(existsSync('.rover/tasks/9')).toBe(false);
      expect(existsSync('.rover/tasks/10')).toBe(false);
      expect(existsSync('.rover/tasks/11')).toBe(false);
    });

    it('should delete tasks in ITERATING status', async () => {
      const taskIterating = createTestTask(12, 'Iterating Task');
      taskIterating.updateIteration({ timestamp: new Date().toISOString() });

      await deleteCommand('12', { yes: true });

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
      const initialWorktrees = execSync('git worktree list').toString();
      expect(initialWorktrees).toContain('rover-task-13');
      expect(initialWorktrees).toContain('rover-task-14');
      expect(initialWorktrees).toContain('rover-task-15');

      // Delete them one by one
      await deleteCommand('13', { yes: true });
      await deleteCommand('14', { yes: true });
      await deleteCommand('15', { yes: true });

      // Verify all deleted
      expect(existsSync('.rover/tasks/13')).toBe(false);
      expect(existsSync('.rover/tasks/14')).toBe(false);
      expect(existsSync('.rover/tasks/15')).toBe(false);

      const finalWorktrees = execSync('git worktree list').toString();
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

      await deleteCommand('16', { yes: true });

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
      await deleteCommand('17', { yes: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'Task deleted successfully!',
        expect.objectContaining({ success: true }),
        false
      );
      expect(existsSync('.rover/tasks/17')).toBe(false);
    });

    it('should handle zero task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await deleteCommand('0');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'The task with ID 0 was not found',
        }),
        false
      );
    });

    it('should handle very large task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await deleteCommand('999999999');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'The task with ID 999999999 was not found',
        }),
        false
      );
    });
  });

  describe('Combined flag scenarios', () => {
    it('should handle --yes and --json flags together', async () => {
      createTestTask(18, 'Combined Flags Task');

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await deleteCommand('18', { yes: true, json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        'Task deleted successfully!',
        expect.objectContaining({ success: true }),
        true // JSON mode
      );
      expect(existsSync('.rover/tasks/18')).toBe(false);
    });
  });

  describe('Telemetry integration', () => {
    it('should call telemetry on successful deletion', async () => {
      createTestTask(19, 'Telemetry Task');

      const { getTelemetry } = await import('../../lib/telemetry.js');
      const mockTelemetry = getTelemetry();

      await deleteCommand('19', { yes: true });

      expect(mockTelemetry?.eventDeleteTask).toHaveBeenCalled();
      expect(mockTelemetry?.shutdown).toHaveBeenCalled();
    });

    it('should call telemetry shutdown even on failure', async () => {
      const { getTelemetry } = await import('../../lib/telemetry.js');
      const mockTelemetry = getTelemetry();

      await deleteCommand('999');

      expect(mockTelemetry?.shutdown).toHaveBeenCalled();
    });
  });
});
