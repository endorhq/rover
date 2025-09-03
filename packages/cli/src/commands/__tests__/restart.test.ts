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

// Mock start command to prevent actual execution
vi.mock('../start.js', () => ({
  startCommand: vi.fn().mockResolvedValue(undefined),
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
  const mockStartCommand = vi.mocked(await import('../start.js')).startCommand;

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
      task.markFailed();
      expect(task.status).toBe('FAILED');

      // Run restart command
      await restartCommand(taskId.toString(), { json: true });

      // Verify task was restarted
      const reloadedTask = TaskDescription.load(taskId);
      expect(reloadedTask.status).toBe('NEW');
      expect(reloadedTask.data.restartCount).toBe(1);
      expect(reloadedTask.data.lastRestartAt).toBeDefined();

      // Verify start command was called
      expect(mockStartCommand).toHaveBeenCalledWith(taskId.toString(), {
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
      task.markFailed();
      await restartCommand(taskId.toString(), { json: true });

      const firstRestart = TaskDescription.load(taskId);
      expect(firstRestart.data.restartCount).toBe(1);

      // Set back to failed and restart again
      firstRestart.markFailed();
      await restartCommand(taskId.toString(), { json: true });

      const secondRestart = TaskDescription.load(taskId);
      expect(secondRestart.data.restartCount).toBe(2);
      expect(mockStartCommand).toHaveBeenCalledTimes(2);
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

      // Verify start command was NOT called
      expect(mockStartCommand).not.toHaveBeenCalled();
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

      // Verify start command was NOT called
      expect(mockStartCommand).not.toHaveBeenCalled();
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

      // Verify start command was NOT called
      expect(mockStartCommand).not.toHaveBeenCalled();
    });
  });

  describe('options handling', () => {
    it('should pass through follow option to start command', async () => {
      // Create a failed task
      const taskId = 111;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      const task = TaskDescription.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
      });

      task.markFailed();

      // Run restart command with follow option
      await restartCommand(taskId.toString(), { follow: true, json: true });

      // Verify start command was called with follow option
      expect(mockStartCommand).toHaveBeenCalledWith(taskId.toString(), {
        follow: true,
        json: true,
      });
    });

    it('should pass through debug option to start command', async () => {
      // Create a failed task
      const taskId = 222;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      const task = TaskDescription.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
      });

      task.markFailed();

      // Run restart command with debug option
      await restartCommand(taskId.toString(), { debug: true, json: true });

      // Verify start command was called with debug option
      expect(mockStartCommand).toHaveBeenCalledWith(taskId.toString(), {
        debug: true,
        json: true,
      });
    });
  });
});
