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
import { startCommand } from '../start.js';
import { TaskDescription } from '../../lib/description.js';

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock Docker execution to prevent actual container execution
vi.mock('../task.js', () => ({
  startDockerExecution: vi.fn().mockResolvedValue(undefined),
}));

// Mock user settings
vi.mock('../../lib/config.js', () => ({
  AI_AGENT: { Claude: 'claude', Gemini: 'gemini', Qwen: 'qwen' },
  UserSettings: {
    exists: vi.fn().mockReturnValue(true),
    load: vi.fn().mockReturnValue({ defaultAiAgent: 'claude' }),
  },
}));

// Mock display utilities to suppress output
vi.mock('../../utils/display.js', () => ({
  showRoverChat: vi.fn(),
}));

// Mock exit utilities to prevent process.exit
vi.mock('../../utils/exit.js', () => ({
  exitWithError: vi.fn().mockImplementation(() => {}),
  exitWithSuccess: vi.fn().mockImplementation(() => {}),
  exitWithWarn: vi.fn().mockImplementation(() => {}),
}));

describe('start command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory with git repo
    testDir = mkdtempSync(join(tmpdir(), 'rover-start-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize git repo
    execSync('git init', { stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { stdio: 'pipe' });
    execSync('git config user.name "Test User"', { stdio: 'pipe' });

    // Create initial commit
    writeFileSync('README.md', '# Test');
    execSync('git add README.md', { stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { stdio: 'pipe' });

    // Create .rover directory structure
    const roverDir = join(testDir, '.rover');
    const tasksDir = join(roverDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  const createTestTask = (
    taskId: number,
    title: string,
    status: 'NEW' | 'IN_PROGRESS' | 'COMPLETED' = 'NEW'
  ) => {
    const task = TaskDescription.create({
      id: taskId,
      title,
      description: `Test task ${taskId}: ${title}`,
    });

    if (status !== 'NEW') {
      task.setStatus(status);
    }

    return task;
  };

  describe('with NEW status task', () => {
    it('should start a task in NEW status successfully', async () => {
      const task = createTestTask(1, 'Test Task', 'NEW');

      await startCommand('1');

      // Should call docker execution
      const { startDockerExecution } = await import('../task.js');
      expect(startDockerExecution).toHaveBeenCalledOnce();

      // Task should be marked as IN_PROGRESS
      const reloadedTask = TaskDescription.load(1);
      expect(reloadedTask.status).toBe('IN_PROGRESS');
    });

    it('should setup workspace if not already configured', async () => {
      const task = createTestTask(2, 'Test Task Without Workspace', 'NEW');

      // Ensure workspace is not set
      expect(task.worktreePath).toBe('');
      expect(task.branchName).toBe('');

      await startCommand('2');

      // Task workspace should now be configured
      const reloadedTask = TaskDescription.load(2);
      expect(reloadedTask.worktreePath).toContain('workspace');
      expect(reloadedTask.branchName).toMatch(/^rover\/task-2-/);
    });

    it('should reset task to NEW if Docker execution fails', async () => {
      const task = createTestTask(3, 'Test Task That Fails', 'NEW');

      // Mock Docker execution to fail
      const { startDockerExecution } = await import('../task.js');
      vi.mocked(startDockerExecution).mockRejectedValueOnce(
        new Error('Docker failed')
      );

      try {
        await startCommand('3');
      } catch {
        // Expected to throw
      }

      // Task should be reset back to NEW status
      const reloadedTask = TaskDescription.load(3);
      expect(reloadedTask.status).toBe('NEW');
    });
  });

  describe('with non-NEW status tasks', () => {
    it('should reject IN_PROGRESS task', async () => {
      const task = createTestTask(4, 'In Progress Task', 'IN_PROGRESS');

      await startCommand('4');

      // Docker execution should not be called
      const { startDockerExecution } = await import('../task.js');
      expect(startDockerExecution).not.toHaveBeenCalled();

      // Task status should remain unchanged
      const reloadedTask = TaskDescription.load(4);
      expect(reloadedTask.status).toBe('IN_PROGRESS');
    });

    it('should reject COMPLETED task', async () => {
      const task = createTestTask(5, 'Completed Task', 'COMPLETED');

      await startCommand('5');

      // Docker execution should not be called
      const { startDockerExecution } = await import('../task.js');
      expect(startDockerExecution).not.toHaveBeenCalled();

      // Task status should remain unchanged
      const reloadedTask = TaskDescription.load(5);
      expect(reloadedTask.status).toBe('COMPLETED');
    });
  });

  describe('error handling', () => {
    it('should handle invalid task ID', async () => {
      const { exitWithError } = await import('../../utils/exit.js');
      const { startDockerExecution } = await import('../task.js');

      await startCommand('invalid');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Invalid task ID 'invalid' - must be a number",
        }),
        false
      );
    });

    it('should handle non-existent task', async () => {
      const { exitWithError } = await import('../../utils/exit.js');

      await startCommand('999');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'The task with ID 999 was not found',
        }),
        false
      );
    });
  });
});
