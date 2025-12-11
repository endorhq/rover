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
import { TaskDescriptionManager } from 'rover-schemas';

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventRestartTask: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock exit utilities to prevent process.exit
vi.mock('../../utils/exit.js', () => ({
  exitWithError: vi.fn().mockImplementation(() => {}),
  exitWithSuccess: vi.fn().mockImplementation(() => {}),
  exitWithWarn: vi.fn().mockImplementation(() => {}),
}));

// Mock sandbox to prevent actual Docker/Podman calls
vi.mock('../../lib/sandbox/index.js', () => ({
  createSandbox: vi.fn().mockResolvedValue({
    createAndStart: vi.fn().mockResolvedValue('mock-container-id'),
  }),
}));

describe('restart command', async () => {
  let testDir: string;
  let originalCwd: string;

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

      const task = TaskDescriptionManager.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Manually set task to FAILED status
      task.markFailed('This task failed');
      expect(task.status).toBe('FAILED');

      // Run restart command
      await restartCommand(taskId.toString(), { json: true });

      // Verify task was restarted
      const reloadedTask = TaskDescriptionManager.load(taskId);
      expect(reloadedTask.status).toBe('IN_PROGRESS');
      expect(reloadedTask.restartCount).toBe(1);
      expect(reloadedTask.lastRestartAt).toBeDefined();
    });

    it('should track multiple restart attempts', async () => {
      // Create a failed task
      const taskId = 456;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      const task = TaskDescriptionManager.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Manually set task to FAILED status and restart twice
      task.markFailed('This task failed');
      await restartCommand(taskId.toString(), { json: true });

      const firstRestart = TaskDescriptionManager.load(taskId);
      expect(firstRestart.restartCount).toBe(1);

      // Set back to failed and restart again
      firstRestart.markFailed('This task failed');
      await restartCommand(taskId.toString(), { json: true });

      const secondRestart = TaskDescriptionManager.load(taskId);
      expect(secondRestart.restartCount).toBe(2);
    });

    it('should reuse stored agent image on restart', async () => {
      // Create a task with a specific agent image
      const taskId = 555;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      const task = TaskDescriptionManager.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Set a custom agent image
      const customImage = 'ghcr.io/endorhq/rover/agent:v1.2.3';
      task.setAgentImage(customImage);

      // Verify it was stored
      expect(task.agentImage).toBe(customImage);

      // Mark task as failed and restart it
      task.markFailed('This task failed');
      await restartCommand(taskId.toString(), { json: true });

      // Reload and verify the agent image is still stored
      const reloadedTask = TaskDescriptionManager.load(taskId);
      expect(reloadedTask.agentImage).toBe(customImage);
      expect(reloadedTask.status).toBe('IN_PROGRESS');
    });
  });

  describe('error handling', () => {
    it('should successfully restart NEW tasks', async () => {
      // Create a task in NEW status
      const taskId = 789;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      const task = TaskDescriptionManager.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
        inputs: new Map(),
        workflowName: 'swe',
      });

      expect(task.status).toBe('NEW');

      // Restart a NEW task should work
      await restartCommand(taskId.toString(), { json: true });

      // Verify task was restarted successfully
      const reloadedTask = TaskDescriptionManager.load(taskId);
      expect(reloadedTask.status).toBe('IN_PROGRESS');
      expect(reloadedTask.restartCount).toBe(1);
    });

    it('should reject restarting tasks not in NEW or FAILED status', async () => {
      const { exitWithError } = await import('../../utils/exit.js');
      const mockExitWithError = vi.mocked(exitWithError);

      // Create a task and set it to IN_PROGRESS status
      const taskId = 790;
      const taskDir = join(testDir, '.rover', 'tasks', taskId.toString());
      mkdirSync(taskDir, { recursive: true });

      const task = TaskDescriptionManager.create({
        id: taskId,
        title: 'Test Task',
        description: 'A test task',
        inputs: new Map(),
        workflowName: 'swe',
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
        expect.objectContaining({
          tips: expect.arrayContaining([
            'Only NEW and FAILED tasks can be restarted',
          ]),
          telemetry: expect.anything(),
        })
      );
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
        expect.objectContaining({
          telemetry: expect.anything(),
        })
      );
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
        expect.objectContaining({
          telemetry: expect.anything(),
        })
      );
    });
  });
});
