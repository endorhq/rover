import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskDescriptionManager } from '../task-description.js';
import {
  TaskStatus,
  CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION,
} from 'rover-schemas';

describe('TaskDescriptionManager', () => {
  let testDir: string;

  // Helper to get task path
  const getTaskPath = (taskId: number) =>
    join(testDir, 'tasks', taskId.toString());

  beforeEach(() => {
    // Create temp directory
    testDir = mkdtempSync(join(tmpdir(), 'rover-description-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('agent and sourceBranch fields', () => {
    it('should store agent and sourceBranch when creating task', () => {
      const taskPath = getTaskPath(1);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 1,
        title: 'Test Task',
        description: 'Test description',
        agent: 'claude',
        sourceBranch: 'main',
        inputs: new Map(),
        workflowName: 'swe',
      });

      expect(task.agent).toBe('claude');
      expect(task.sourceBranch).toBe('main');

      // Verify persistence
      const reloaded = TaskDescriptionManager.load(taskPath, 1);
      expect(reloaded.agent).toBe('claude');
      expect(reloaded.sourceBranch).toBe('main');
    });

    it('should handle tasks without agent and sourceBranch fields', () => {
      const taskPath = getTaskPath(2);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 2,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      expect(task.agent).toBeUndefined();
      expect(task.sourceBranch).toBeUndefined();
    });
  });

  describe('agentImage field', () => {
    it('should store and retrieve agentImage', () => {
      const taskPath = getTaskPath(1);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 1,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Initially should be undefined
      expect(task.agentImage).toBeUndefined();

      // Set agent image
      const customImage = 'ghcr.io/endorhq/rover/agent:v1.2.3';
      task.setAgentImage(customImage);
      expect(task.agentImage).toBe(customImage);

      // Verify persistence
      const reloaded = TaskDescriptionManager.load(taskPath, 1);
      expect(reloaded.agentImage).toBe(customImage);
    });

    it('should preserve agentImage during migration', () => {
      const taskPath = getTaskPath(2);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 2,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      const customImage = 'ghcr.io/endorhq/rover/agent:v2.0.0';
      task.setAgentImage(customImage);

      // Reload to trigger migration path
      const reloaded = TaskDescriptionManager.load(taskPath, 2);
      expect(reloaded.agentImage).toBe(customImage);
    });

    it('should handle tasks without agentImage field', () => {
      const taskPath = getTaskPath(3);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 3,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      expect(task.agentImage).toBeUndefined();

      // Verify persistence of undefined value
      const reloaded = TaskDescriptionManager.load(taskPath, 3);
      expect(reloaded.agentImage).toBeUndefined();
    });
  });

  describe('new status types', () => {
    it('should support MERGED status', () => {
      const taskPath = getTaskPath(1);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 1,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markMerged();

      expect(task.status).toBe('MERGED');
      expect(task.isMerged()).toBe(true);
      expect(task.completedAt).toBeDefined();
    });

    it('should support PUSHED status', () => {
      const taskPath = getTaskPath(2);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 2,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markPushed();

      expect(task.status).toBe('PUSHED');
      expect(task.isPushed()).toBe(true);
      expect(task.completedAt).toBeDefined();
    });

    it('should support resetting to NEW status', () => {
      const taskPath = getTaskPath(3);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 3,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Mark as in progress first
      task.markInProgress();
      expect(task.status).toBe('IN_PROGRESS');

      // Reset to NEW
      task.resetToNew();
      expect(task.status).toBe('NEW');
      expect(task.isNew()).toBe(true);
    });

    it('should handle MERGED and PUSHED in status validation', () => {
      const taskPath = getTaskPath(4);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 4,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Test all new status types
      const newStatuses: TaskStatus[] = ['MERGED', 'PUSHED'];

      for (const status of newStatuses) {
        task.setStatus(status);
        expect(task.status).toBe(status);

        // Should not throw validation errors
        expect(() => task.save()).not.toThrow();
      }
    });

    it('should not set completedAt when marking as MERGED', () => {
      const taskPath = getTaskPath(5);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 5,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markCompleted();
      const beforeTime = task.completedAt;

      // Marking as merged should not change `completedAt` timestamp; the task was already complete
      task.markMerged();
      expect(task.completedAt!).toEqual(beforeTime);
    });
  });

  it('should not set completedAt when marking as PUSHED', () => {
    const taskPath = getTaskPath(6);
    const task = TaskDescriptionManager.create(taskPath, {
      id: 6,
      title: 'Test Task',
      description: 'Test description',
      inputs: new Map(),
      workflowName: 'swe',
    });

    task.markCompleted();
    task.markMerged();
    const beforeTime = task.completedAt;

    // Marking as pushed should not change `completedAt` timestamp; the task was already complete
    task.markPushed();
    expect(task.completedAt!).toEqual(beforeTime);
  });

  describe('status migration', () => {
    it('should migrate old status values to new enum including MERGED and PUSHED', () => {
      const taskPath = getTaskPath(7);
      // Test the static migration method indirectly by loading tasks with old data
      const task = TaskDescriptionManager.create(taskPath, {
        id: 7,
        title: 'Migration Test',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Test MERGED migration
      task.setStatus('MERGED' as TaskStatus);
      task.save();

      const reloadedTask = TaskDescriptionManager.load(taskPath, 7);
      expect(reloadedTask.status).toBe('MERGED');
      expect(reloadedTask.isMerged()).toBe(true);
    });

    it('should set optional datetime fields to undefined when migrating from v1.1 with missing fields', () => {
      // Import necessary modules
      const { readFileSync, writeFileSync } = require('node:fs');

      const taskPath = getTaskPath(8);
      // Create a task (this automatically saves it)
      TaskDescriptionManager.create(taskPath, {
        id: 8,
        title: 'Migration DateTime Test',
        description: 'Test missing datetime fields',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Manually modify the task file to simulate v1.1 schema with missing optional datetime fields
      const descriptionPath = join(taskPath, 'description.json');
      const taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));

      // Simulate v1.1 schema by removing version and optional datetime fields
      delete taskData.version;
      delete taskData.startedAt;
      delete taskData.completedAt;
      delete taskData.failedAt;
      delete taskData.lastIterationAt;
      delete taskData.lastStatusCheck;
      delete taskData.lastRestartAt;

      writeFileSync(descriptionPath, JSON.stringify(taskData, null, 2), 'utf8');

      // Reload the task - should trigger migration
      const migratedTask = TaskDescriptionManager.load(taskPath, 8);

      // Verify that optional datetime fields are undefined (not empty strings)
      expect(migratedTask.startedAt).toBeUndefined();
      expect(migratedTask.completedAt).toBeUndefined();
      expect(migratedTask.failedAt).toBeUndefined();
      expect(migratedTask.lastIterationAt).toBeUndefined();
      expect(migratedTask.lastStatusCheck).toBeUndefined();
      expect(migratedTask.lastRestartAt).toBeUndefined();

      // Verify that the task was migrated to current version
      expect(migratedTask.version).toBe(
        CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION
      );

      // Ensure task can be saved without validation errors
      expect(() => migratedTask.save()).not.toThrow();
    });
  });

  describe('sandboxMetadata field', () => {
    it('should store and retrieve sandboxMetadata via setContainerInfo', () => {
      const taskPath = getTaskPath(10);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 10,
        title: 'Sandbox Metadata Test',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Initially should be undefined
      expect(task.sandboxMetadata).toBeUndefined();

      // Set container info with sandboxMetadata
      task.setContainerInfo('container-123', 'running', {
        dockerHost: 'unix:///var/run/docker.sock',
      });
      expect(task.sandboxMetadata).toEqual({
        dockerHost: 'unix:///var/run/docker.sock',
      });
      expect(task.containerId).toBe('container-123');

      // Verify persistence
      const reloaded = TaskDescriptionManager.load(taskPath, 10);
      expect(reloaded.sandboxMetadata).toEqual({
        dockerHost: 'unix:///var/run/docker.sock',
      });
      expect(reloaded.containerId).toBe('container-123');
    });

    it('should handle undefined sandboxMetadata in setContainerInfo', () => {
      const taskPath = getTaskPath(11);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 11,
        title: 'Sandbox Metadata Undefined Test',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Set container info without sandboxMetadata
      task.setContainerInfo('container-456', 'running');
      expect(task.sandboxMetadata).toBeUndefined();
      expect(task.containerId).toBe('container-456');

      // Verify persistence
      const reloaded = TaskDescriptionManager.load(taskPath, 11);
      expect(reloaded.sandboxMetadata).toBeUndefined();
    });

    it('should migrate legacy dockerHost to sandboxMetadata', () => {
      const { readFileSync, writeFileSync } = require('node:fs');

      const taskPath = getTaskPath(12);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 12,
        title: 'Docker Host Migration Test',
        description: 'Test migration',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Manually set old dockerHost field and version to simulate legacy data
      const descriptionPath = join(taskPath, 'description.json');
      const taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));
      taskData.version = '1.4'; // Old version
      taskData.dockerHost = 'tcp://192.168.1.100:2375'; // Legacy field
      delete taskData.sandboxMetadata; // Ensure no sandboxMetadata
      writeFileSync(descriptionPath, JSON.stringify(taskData, null, 2), 'utf8');

      // Reload - should trigger migration and convert dockerHost to sandboxMetadata
      const migratedTask = TaskDescriptionManager.load(taskPath, 12);
      expect(migratedTask.sandboxMetadata).toEqual({
        dockerHost: 'tcp://192.168.1.100:2375',
      });
      expect(migratedTask.version).toBe(
        CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION
      );
    });

    it('should support arbitrary metadata keys in sandboxMetadata', () => {
      const taskPath = getTaskPath(13);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 13,
        title: 'Arbitrary Metadata Test',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Set container info with arbitrary metadata
      const metadata = {
        dockerHost: 'tcp://localhost:2375',
        customKey: 'customValue',
        nested: { foo: 'bar' },
      };
      task.setContainerInfo('container-999', 'running', metadata);
      expect(task.sandboxMetadata).toEqual(metadata);

      // Verify persistence
      const reloaded = TaskDescriptionManager.load(taskPath, 13);
      expect(reloaded.sandboxMetadata).toEqual(metadata);
    });
  });

  describe('pause/resume lifecycle', () => {
    it('should set PAUSED status with error and pausedAt', () => {
      const taskPath = getTaskPath(14);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 14,
        title: 'Pause Test',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markInProgress();
      task.markPaused('Credit limit exceeded');

      expect(task.status).toBe('PAUSED');
      expect(task.isPaused()).toBe(true);
      expect(task.error).toBe('Credit limit exceeded');
      expect(task.pausedAt).toBeDefined();

      // Verify persistence
      const reloaded = TaskDescriptionManager.load(taskPath, 14);
      expect(reloaded.status).toBe('PAUSED');
      expect(reloaded.isPaused()).toBe(true);
      expect(reloaded.error).toBe('Credit limit exceeded');
      expect(reloaded.pausedAt).toBeDefined();
    });

    it('should clear error and pausedAt when resuming to IN_PROGRESS', () => {
      const taskPath = getTaskPath(15);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 15,
        title: 'Resume Test',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markInProgress();
      task.markPaused('Rate limit');
      expect(task.pausedAt).toBeDefined();
      expect(task.error).toBe('Rate limit');

      task.markInProgress();
      expect(task.status).toBe('IN_PROGRESS');
      expect(task.isPaused()).toBe(false);
      expect(task.error).toBeUndefined();
      expect(task.pausedAt).toBeUndefined();

      // Verify persistence
      const reloaded = TaskDescriptionManager.load(taskPath, 15);
      expect(reloaded.error).toBeUndefined();
      expect(reloaded.pausedAt).toBeUndefined();
    });

    it('should clear error and pausedAt when transitioning to ITERATING', () => {
      const taskPath = getTaskPath(16);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 16,
        title: 'Iterate After Pause',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markInProgress();
      task.markPaused('Credit exhausted');
      task.markIterating();

      expect(task.status).toBe('ITERATING');
      expect(task.error).toBeUndefined();
      expect(task.pausedAt).toBeUndefined();
    });

    it('should report isActive() as false for PAUSED', () => {
      const taskPath = getTaskPath(17);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 17,
        title: 'Active Check',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markInProgress();
      expect(task.isActive()).toBe(true);

      task.markPaused('Paused');
      expect(task.isActive()).toBe(false);
    });

    it('should clear previous error when markPaused() is called without an error', () => {
      const taskPath = getTaskPath(18);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 18,
        title: 'Pause No Error',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markInProgress();
      task.markFailed('Previous failure');
      expect(task.error).toBe('Previous failure');

      task.markPaused();
      expect(task.status).toBe('PAUSED');
      expect(task.pausedAt).toBeDefined();
      expect(task.error).toBeUndefined();

      // Verify persistence
      const reloaded = TaskDescriptionManager.load(taskPath, 18);
      expect(reloaded.status).toBe('PAUSED');
      expect(reloaded.error).toBeUndefined();
      expect(reloaded.pausedAt).toBeDefined();
    });

    it('should map paused iteration status to PAUSED task status via updateStatusFromIteration', () => {
      const { mkdirSync, writeFileSync } = require('node:fs');

      const taskPath = getTaskPath(19);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 19,
        title: 'Iteration Pause Map',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markInProgress();

      // Create a proper iteration directory with both iteration.json and status.json
      const iterationPath = join(
        taskPath,
        'iterations',
        (task.iterations || 1).toString()
      );
      mkdirSync(iterationPath, { recursive: true });
      writeFileSync(
        join(iterationPath, 'iteration.json'),
        JSON.stringify({
          version: '1.1',
          iteration: 1,
          id: 19,
          title: 'Iteration Pause Map',
          description: 'Test description',
          createdAt: new Date().toISOString(),
          previousContext: {},
          context: [],
        })
      );
      const now = new Date().toISOString();
      writeFileSync(
        join(iterationPath, 'status.json'),
        JSON.stringify({
          taskId: '19',
          status: 'paused',
          currentStep: 'step-1',
          progress: 50,
          startedAt: now,
          updatedAt: now,
          error: 'Credit limit hit',
        })
      );

      task.updateStatusFromIteration();
      expect(task.status).toBe('PAUSED');
      expect(task.error).toBe('Credit limit hit');
    });

    it('should clear pausedAt when transitioning to FAILED', () => {
      const taskPath = getTaskPath(22);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 22,
        title: 'Pause Then Fail',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markInProgress();
      task.markPaused('Credit limit');
      expect(task.pausedAt).toBeDefined();

      task.markFailed('Container crashed');
      expect(task.status).toBe('FAILED');
      expect(task.pausedAt).toBeUndefined();
      expect(task.error).toBe('Container crashed');

      const reloaded = TaskDescriptionManager.load(taskPath, 22);
      expect(reloaded.pausedAt).toBeUndefined();
    });

    it('should clear pausedAt when transitioning to COMPLETED', () => {
      const taskPath = getTaskPath(23);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 23,
        title: 'Pause Then Complete',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markInProgress();
      task.markPaused('Credit limit');
      expect(task.pausedAt).toBeDefined();

      task.markCompleted();
      expect(task.status).toBe('COMPLETED');
      expect(task.pausedAt).toBeUndefined();

      const reloaded = TaskDescriptionManager.load(taskPath, 23);
      expect(reloaded.pausedAt).toBeUndefined();
    });

    it('should clear pausedAt when transitioning to MERGED or PUSHED', () => {
      const taskPath = getTaskPath(24);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 24,
        title: 'Pause Then Merge',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markInProgress();
      task.markPaused('Credit limit');
      expect(task.pausedAt).toBeDefined();

      task.markMerged();
      expect(task.status).toBe('MERGED');
      expect(task.pausedAt).toBeUndefined();
    });

    it('should return null from getDuration() when task is PAUSED', () => {
      const taskPath = getTaskPath(20);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 20,
        title: 'Duration Paused',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      task.markInProgress();
      task.markPaused('Paused');

      // PAUSED sets pausedAt but not completedAt or failedAt,
      // so getDuration() returns null (pause is non-terminal).
      expect(task.getDuration()).toBeNull();
    });
  });

  describe('schema migration', () => {
    it('should handle v1.5 schema without pausedAt field', () => {
      const { readFileSync, writeFileSync } = require('node:fs');

      const taskPath = getTaskPath(21);
      TaskDescriptionManager.create(taskPath, {
        id: 21,
        title: 'Migration PausedAt Test',
        description: 'Test pausedAt migration',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Simulate v1.5 schema by removing pausedAt and setting older version
      const descriptionPath = join(taskPath, 'description.json');
      const taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));
      delete taskData.pausedAt;
      taskData.version = '1.5';
      writeFileSync(descriptionPath, JSON.stringify(taskData, null, 2), 'utf8');

      // Reload should migrate cleanly
      const migratedTask = TaskDescriptionManager.load(taskPath, 21);
      expect(migratedTask.pausedAt).toBeUndefined();
      expect(migratedTask.version).toBe(
        CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION
      );
      expect(() => migratedTask.save()).not.toThrow();
    });
  });

  describe('utility methods', () => {
    it('should provide correct utility methods for new statuses', () => {
      const taskPath = getTaskPath(9);
      const task = TaskDescriptionManager.create(taskPath, {
        id: 9,
        title: 'Utility Test',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Test NEW status
      expect(task.isNew()).toBe(true);
      expect(task.isMerged()).toBe(false);
      expect(task.isPushed()).toBe(false);

      // Test MERGED status
      task.markMerged();
      expect(task.isNew()).toBe(false);
      expect(task.isMerged()).toBe(true);
      expect(task.isPushed()).toBe(false);
      expect(task.isCompleted()).toBe(false); // MERGED is different from COMPLETED

      // Reset and test PUSHED status
      task.resetToNew();
      task.markPushed();
      expect(task.isNew()).toBe(false);
      expect(task.isMerged()).toBe(false);
      expect(task.isPushed()).toBe(true);
      expect(task.isCompleted()).toBe(false); // PUSHED is different from COMPLETED
    });
  });
});
