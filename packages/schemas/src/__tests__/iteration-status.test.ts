import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IterationStatusManager } from '../iteration-status.js';

describe('IterationStatusManager', () => {
  let testDir: string;
  let statusFilePath: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-status-test-'));
    statusFilePath = join(testDir, 'status.json');
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('createInitial', () => {
    it('should create a new status file with initial values', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-123',
        'Starting task'
      );

      // Verify file was created
      expect(existsSync(statusFilePath)).toBe(true);

      // Verify initial values
      expect(status.taskId).toBe('task-123');
      expect(status.status).toBe('initializing');
      expect(status.currentStep).toBe('Starting task');
      expect(status.progress).toBe(0);
      expect(status.startedAt).toBeDefined();
      expect(status.updatedAt).toBeDefined();
      expect(status.completedAt).toBeUndefined();
      expect(status.error).toBeUndefined();
    });

    it('should persist status data to disk', () => {
      IterationStatusManager.createInitial(
        statusFilePath,
        'task-456',
        'Initialization step'
      );

      // Read file directly and verify content
      const fileContent = JSON.parse(readFileSync(statusFilePath, 'utf8'));
      expect(fileContent.taskId).toBe('task-456');
      expect(fileContent.status).toBe('initializing');
      expect(fileContent.currentStep).toBe('Initialization step');
      expect(fileContent.progress).toBe(0);
    });

    it('should set timestamps to ISO format', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-789',
        'Start'
      );

      // Verify timestamps are valid ISO strings
      expect(() => new Date(status.startedAt)).not.toThrow();
      expect(() => new Date(status.updatedAt)).not.toThrow();
      expect(status.startedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
    });
  });

  describe('load', () => {
    it('should load existing status file', () => {
      // Create a status file first
      const created = IterationStatusManager.createInitial(
        statusFilePath,
        'task-abc',
        'Initial step'
      );

      // Load it
      const loaded = IterationStatusManager.load(statusFilePath);

      expect(loaded.taskId).toBe(created.taskId);
      expect(loaded.status).toBe(created.status);
      expect(loaded.currentStep).toBe(created.currentStep);
      expect(loaded.progress).toBe(created.progress);
    });

    it('should throw error if file does not exist', () => {
      const nonExistentPath = join(testDir, 'nonexistent.json');

      expect(() => IterationStatusManager.load(nonExistentPath)).toThrow(
        `Status file not found at ${nonExistentPath}`
      );
    });

    it('should throw error for invalid JSON', async () => {
      // Write invalid JSON to file
      const fs = await import('node:fs');
      fs.writeFileSync(statusFilePath, 'invalid json{', 'utf8');

      expect(() => IterationStatusManager.load(statusFilePath)).toThrow(
        'Invalid JSON in status file'
      );
    });

    it('should preserve all fields when loading', () => {
      // Create status with all fields
      const created = IterationStatusManager.createInitial(
        statusFilePath,
        'task-def',
        'Step 1'
      );
      created.update('running', 'Step 2', 50, 'Minor issue');
      created.complete('Final step');

      // Load and verify all fields are preserved
      const loaded = IterationStatusManager.load(statusFilePath);

      expect(loaded.taskId).toBe('task-def');
      expect(loaded.status).toBe('completed');
      expect(loaded.currentStep).toBe('Final step');
      expect(loaded.progress).toBe(100);
      expect(loaded.completedAt).toBeDefined();
      expect(loaded.error).toBe('Minor issue');
    });
  });

  describe('update', () => {
    it('should update status fields and persist to disk', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-update',
        'Initial'
      );

      status.update('running', 'Processing data', 50);

      expect(status.status).toBe('running');
      expect(status.currentStep).toBe('Processing data');
      expect(status.progress).toBe(50);

      // Verify persistence
      const loaded = IterationStatusManager.load(statusFilePath);
      expect(loaded.status).toBe('running');
      expect(loaded.progress).toBe(50);
    });

    it('should update timestamp on each update', async () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-time',
        'Start'
      );
      const initialUpdatedAt = status.updatedAt;

      // Small delay to ensure timestamp difference
      const delay = () => new Promise(resolve => setTimeout(resolve, 10));
      await delay();

      status.update('running', 'Next step', 25);

      expect(status.updatedAt).not.toBe(initialUpdatedAt);
      expect(new Date(status.updatedAt).getTime()).toBeGreaterThan(
        new Date(initialUpdatedAt).getTime()
      );
    });

    it('should optionally set error field', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-error',
        'Start'
      );

      status.update('failed', 'Failed step', 30, 'Connection timeout');

      expect(status.error).toBe('Connection timeout');

      // Verify persistence
      const loaded = IterationStatusManager.load(statusFilePath);
      expect(loaded.error).toBe('Connection timeout');
    });

    it('should allow updating without error field', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-no-error',
        'Start'
      );

      status.update('running', 'Progress', 75);

      expect(status.error).toBeUndefined();
    });
  });

  describe('complete', () => {
    it('should mark status as completed with 100% progress', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-complete',
        'Start'
      );

      status.complete('Task finished');

      expect(status.status).toBe('completed');
      expect(status.currentStep).toBe('Task finished');
      expect(status.progress).toBe(100);
      expect(status.completedAt).toBeDefined();
    });

    it('should set completedAt timestamp', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-timestamp',
        'Start'
      );

      const beforeComplete = new Date().toISOString();
      status.complete('Done');
      const afterComplete = new Date().toISOString();

      expect(status.completedAt).toBeDefined();
      expect(new Date(status.completedAt!).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeComplete).getTime()
      );
      expect(new Date(status.completedAt!).getTime()).toBeLessThanOrEqual(
        new Date(afterComplete).getTime()
      );
    });

    it('should persist completion to disk', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-persist',
        'Start'
      );

      status.complete('All done');

      const loaded = IterationStatusManager.load(statusFilePath);
      expect(loaded.status).toBe('completed');
      expect(loaded.progress).toBe(100);
      expect(loaded.completedAt).toBeDefined();
    });
  });

  describe('fail', () => {
    it('should mark status as failed with error message', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-fail',
        'Start'
      );

      status.fail('Execution failed', 'Out of memory');

      expect(status.status).toBe('failed');
      expect(status.currentStep).toBe('Execution failed');
      expect(status.progress).toBe(100);
      expect(status.error).toBe('Out of memory');
      expect(status.completedAt).toBeDefined();
    });

    it('should set both completedAt and error fields', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-fail-both',
        'Start'
      );

      status.fail('Build failed', 'TypeScript compilation error');

      expect(status.completedAt).toBeDefined();
      expect(status.error).toBe('TypeScript compilation error');
    });

    it('should persist failure to disk', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-persist-fail',
        'Start'
      );

      status.fail('Database error', 'Connection refused');

      const loaded = IterationStatusManager.load(statusFilePath);
      expect(loaded.status).toBe('failed');
      expect(loaded.error).toBe('Connection refused');
      expect(loaded.completedAt).toBeDefined();
    });
  });

  describe('getter methods', () => {
    it('should provide access to all status fields', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-getters',
        'Initial step'
      );

      expect(status.taskId).toBe('task-getters');
      expect(status.status).toBe('initializing');
      expect(status.currentStep).toBe('Initial step');
      expect(status.progress).toBe(0);
      expect(status.startedAt).toBeDefined();
      expect(status.updatedAt).toBeDefined();
      expect(status.completedAt).toBeUndefined();
      expect(status.error).toBeUndefined();
    });

    it('should return updated values after modifications', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-modified',
        'Start'
      );

      status.update('running', 'Processing', 50, 'Warning message');

      expect(status.status).toBe('running');
      expect(status.currentStep).toBe('Processing');
      expect(status.progress).toBe(50);
      expect(status.error).toBe('Warning message');
    });
  });

  describe('toJSON', () => {
    it('should return a copy of status data', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-json',
        'Start'
      );

      const json = status.toJSON();

      expect(json.taskId).toBe('task-json');
      expect(json.status).toBe('initializing');
      expect(json.currentStep).toBe('Start');
      expect(json.progress).toBe(0);
    });

    it('should return a new object each time', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-copy',
        'Start'
      );

      const json1 = status.toJSON();
      const json2 = status.toJSON();

      expect(json1).not.toBe(json2);
      expect(json1).toEqual(json2);
    });

    it('should include all fields including optional ones', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-all-fields',
        'Start'
      );
      status.fail('Failed', 'Test error');

      const json = status.toJSON();

      expect(json).toHaveProperty('taskId');
      expect(json).toHaveProperty('status');
      expect(json).toHaveProperty('currentStep');
      expect(json).toHaveProperty('progress');
      expect(json).toHaveProperty('startedAt');
      expect(json).toHaveProperty('updatedAt');
      expect(json).toHaveProperty('completedAt');
      expect(json).toHaveProperty('error');
    });

    it('should not affect original data when modified', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-immutable',
        'Start'
      );

      const json = status.toJSON();
      json.status = 'running';

      expect(status.status).toBe('initializing');
    });
  });

  describe('edge cases', () => {
    it('should handle rapid successive updates', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-rapid',
        'Start'
      );

      status.update('running', 'Step 1', 25);
      status.update('running', 'Step 2', 50);
      status.update('running', 'Step 3', 75);

      expect(status.progress).toBe(75);
      expect(status.currentStep).toBe('Step 3');

      // Verify persistence of final state
      const loaded = IterationStatusManager.load(statusFilePath);
      expect(loaded.progress).toBe(75);
    });

    it('should handle unicode characters in step names and errors', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-unicode',
        'Processing データ 🚀'
      );

      status.update('running', '进行中', 50, 'Erreur système 💥');

      expect(status.currentStep).toBe('进行中');
      expect(status.error).toBe('Erreur système 💥');

      // Verify persistence
      const loaded = IterationStatusManager.load(statusFilePath);
      expect(loaded.currentStep).toBe('进行中');
      expect(loaded.error).toBe('Erreur système 💥');
    });

    it('should handle very long error messages', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-long-error',
        'Start'
      );

      const longError = 'Error: '.repeat(1000);
      status.fail('Failed', longError);

      expect(status.error).toBe(longError);

      // Verify persistence
      const loaded = IterationStatusManager.load(statusFilePath);
      expect(loaded.error).toBe(longError);
    });

    it('should handle empty string values', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-empty',
        ''
      );

      status.update('running', '', 0, '');

      expect(status.currentStep).toBe('');
      expect(status.status).toBe('');
      expect(status.error).toBeUndefined();
    });

    it('should handle progress values at boundaries', () => {
      const status = IterationStatusManager.createInitial(
        statusFilePath,
        'task-boundaries',
        'Start'
      );

      status.update('running', 'Min', 0);
      expect(status.progress).toBe(0);

      status.update('running', 'Max', 100);
      expect(status.progress).toBe(100);
    });
  });
});
