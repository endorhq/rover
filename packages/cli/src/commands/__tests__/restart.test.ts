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

// Mock restart command to prevent actual execution
vi.mock('../restart.js', () => ({
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
  const mockRestartCommand = vi.mocked(
    await import('../restart.js')
  ).restartCommand;

  beforeEach(() => {
    // Create temporary directory for test
    testDir = mkdtempSync(join(tmpdir(), 'rover-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize git repository
    execSync('git init', { stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { stdio: 'pipe' });
    execSync('git config user.name "Test User"', { stdio: 'pipe' });

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
      expect(reloadedTask.data.restartCount).toBe(1);
      expect(reloadedTask.data.lastRestartAt).toBeDefined();

      // Verify start command was called
      expect(mockRestartCommand).toHaveBeenCalledWith(taskId.toString(), {
        json: true,
      });
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
      expect(firstRestart.data.restartCount).toBe(1);

      // Set back to failed and restart again
      firstRestart.markFailed('This task failed');
      await restartCommand(taskId.toString(), { json: true });

      const secondRestart = TaskDescription.load(taskId);
      expect(secondRestart.data.restartCount).toBe(2);
      expect(mockRestartCommand).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should reject restarting non-failed tasks', async () => {
      const { exitWithError } = await import('../../utils/exit.js');
      const mockExitWithError = vi.mocked(exitWithError);

      // Create a task in NEW status
      const taskId = 789;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      TaskDescription.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
      });

      // Try to restart a NEW task
      await restartCommand(taskId.toString(), { json: true });

      // Verify error was called
      expect(mockExitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('not in FAILED status'),
        }),
        true,
        expect.objectContaining({
          tips: expect.arrayContaining([
            'Only FAILED tasks can be restarted',
            expect.stringContaining('rover start'),
          ]),
        })
      );

      // Verify restart command was NOT called
      expect(mockRestartCommand).not.toHaveBeenCalled();
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

      // Verify restart command was NOT called
      expect(mockRestartCommand).not.toHaveBeenCalled();
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

      // Verify restart command was NOT called
      expect(mockRestartCommand).not.toHaveBeenCalled();
    });
  });
});
