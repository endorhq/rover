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
import { restartCommand } from '../restart.js';
import { TaskDescription } from '../../lib/description.js';

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock Docker execution and task execution to prevent actual execution
vi.mock('../task.js', () => ({
  startDockerExecution: vi.fn().mockResolvedValue(undefined),
}));

// Mock exit utilities to prevent process.exit
vi.mock('../../utils/exit.js', () => ({
  exitWithError: vi.fn().mockImplementation(() => {}),
  exitWithSuccess: vi.fn().mockImplementation(() => {}),
  exitWithWarn: vi.fn().mockImplementation(() => {}),
}));

describe('restart command', async () => {
  let testDir: string;
  let originalCwd: string;
  const mockStartDockerExecution = vi.mocked(
    await import('../task.js')
  ).startDockerExecution;

  beforeEach(() => {
    // Create temporary directory for test
    testDir = mkdtempSync(join(tmpdir(), 'rover-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize git repository
    execSync('git init', { stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { stdio: 'pipe' });
    execSync('git config user.name "Test User"', { stdio: 'pipe' });
    execSync('git config commit.gpgsign false');

    // Create main branch and initial commit
    writeFileSync(join(testDir, 'README.md'), '# Test Project');
    execSync('git add README.md', { stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { stdio: 'pipe' });

    // Switch to main branch (some Git versions default to 'master')
    try {
      execSync('git checkout -b main', { stdio: 'pipe' });
    } catch {
      // Branch might already exist or be called 'master'
    }

    // Create rover.json to indicate this is a Rover project
    writeFileSync(
      join(testDir, 'rover.json'),
      JSON.stringify({ name: 'test-project' })
    );

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('basic functionality', () => {
    it('should restart a failed task successfully', async () => {
      // Create a failed task
      const taskId = 123;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      const task = TaskDescription.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
      });

      // Manually set task to FAILED status
      task.markFailed('This task failed');
      expect(task.status).toBe('FAILED');

      // Run restart command
      await restartCommand(taskId.toString(), { json: true });

      // Verify task was restarted
      const reloadedTask = TaskDescription.load(taskId);
      expect(reloadedTask.status).toBe('IN_PROGRESS');
      expect(reloadedTask.restartCount).toBe(1);
      expect(reloadedTask.lastRestartAt).toBeDefined();

      // Verify Docker execution was called
      expect(mockStartDockerExecution).toHaveBeenCalledWith(
        taskId,
        expect.any(Object), // task object
        expect.any(String), // workspace path
        expect.any(String), // iteration path
        expect.any(String), // AI agent
        true // json flag
      );
    });

    it('should track multiple restart attempts', async () => {
      // Create a failed task
      const taskId = 456;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      const task = TaskDescription.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
      });

      // Manually set task to FAILED status and restart twice
      task.markFailed('This task failed');
      await restartCommand(taskId.toString(), { json: true });

      const firstRestart = TaskDescription.load(taskId);
      expect(firstRestart.restartCount).toBe(1);

      // Set back to failed and restart again
      firstRestart.markFailed('This task failed');
      await restartCommand(taskId.toString(), { json: true });

      const secondRestart = TaskDescription.load(taskId);
      expect(secondRestart.restartCount).toBe(2);
      expect(mockStartDockerExecution).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should successfully restart NEW tasks', async () => {
      // Create a task in NEW status
      const taskId = 789;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      const task = TaskDescription.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
      });

      expect(task.status).toBe('NEW');

      // Restart a NEW task should work
      await restartCommand(taskId.toString(), { json: true });

      // Verify task was restarted successfully
      const reloadedTask = TaskDescription.load(taskId);
      expect(reloadedTask.status).toBe('IN_PROGRESS');
      expect(reloadedTask.restartCount).toBe(1);

      // Verify Docker execution was called
      expect(mockStartDockerExecution).toHaveBeenCalledWith(
        taskId,
        expect.any(Object), // task object
        expect.any(String), // workspace path
        expect.any(String), // iteration path
        expect.any(String), // AI agent
        true // json flag
      );
    });

    it('should reject restarting tasks not in NEW or FAILED status', async () => {
      const { exitWithError } = await import('../../utils/exit.js');
      const mockExitWithError = vi.mocked(exitWithError);

      // Create a task and set it to IN_PROGRESS status
      const taskId = 790;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      const task = TaskDescription.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
      });

      // Manually set to IN_PROGRESS
      task.markInProgress();
      expect(task.status).toBe('IN_PROGRESS');

      // Try to restart an IN_PROGRESS task
      await restartCommand(taskId.toString(), { json: true });

      // Verify error was called
      expect(mockExitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('not in NEW or FAILED status'),
        }),
        true,
        expect.objectContaining({
          tips: expect.arrayContaining([
            'Only NEW and FAILED tasks can be restarted',
          ]),
        })
      );

      // Verify Docker execution was NOT called
      expect(mockStartDockerExecution).not.toHaveBeenCalled();
    });

    it('should handle invalid task IDs', async () => {
      const { exitWithError } = await import('../../utils/exit.js');
      const mockExitWithError = vi.mocked(exitWithError);

      // Try to restart with invalid task ID
      await restartCommand('invalid', { json: true });

      // Verify error was called
      expect(mockExitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Invalid task ID'),
        }),
        true
      );

      // Verify Docker execution was NOT called
      expect(mockStartDockerExecution).not.toHaveBeenCalled();
    });

    it('should handle non-existent tasks', async () => {
      const { exitWithError } = await import('../../utils/exit.js');
      const mockExitWithError = vi.mocked(exitWithError);

      // Try to restart non-existent task
      await restartCommand('999', { json: true });

      // Verify error was called
      expect(mockExitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('not found'),
        }),
        true
      );

      // Verify Docker execution was NOT called
      expect(mockStartDockerExecution).not.toHaveBeenCalled();
    });
  });
});
