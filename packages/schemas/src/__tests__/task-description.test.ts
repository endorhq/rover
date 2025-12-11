import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskDescriptionManager, TaskStatus } from '../index.js';

describe('TaskDescriptionManager', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory
    testDir = mkdtempSync(join(tmpdir(), 'rover-description-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('agent and sourceBranch fields', () => {
    it('should store agent and sourceBranch when creating task', () => {
      const task = TaskDescriptionManager.create({
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
      const reloaded = TaskDescriptionManager.load(1);
      expect(reloaded.agent).toBe('claude');
      expect(reloaded.sourceBranch).toBe('main');
    });

    it('should handle tasks without agent and sourceBranch fields', () => {
      const task = TaskDescriptionManager.create({
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
      const task = TaskDescriptionManager.create({
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
      const reloaded = TaskDescriptionManager.load(1);
      expect(reloaded.agentImage).toBe(customImage);
    });

    it('should preserve agentImage during migration', () => {
      const task = TaskDescriptionManager.create({
        id: 2,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      const customImage = 'ghcr.io/endorhq/rover/agent:v2.0.0';
      task.setAgentImage(customImage);

      // Reload to trigger migration path
      const reloaded = TaskDescriptionManager.load(2);
      expect(reloaded.agentImage).toBe(customImage);
    });

    it('should handle tasks without agentImage field', () => {
      const task = TaskDescriptionManager.create({
        id: 3,
        title: 'Test Task',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      expect(task.agentImage).toBeUndefined();

      // Verify persistence of undefined value
      const reloaded = TaskDescriptionManager.load(3);
      expect(reloaded.agentImage).toBeUndefined();
    });
  });

  describe('new status types', () => {
    it('should support MERGED status', () => {
      const task = TaskDescriptionManager.create({
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
      const task = TaskDescriptionManager.create({
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
      const task = TaskDescriptionManager.create({
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
      const task = TaskDescriptionManager.create({
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
      const task = TaskDescriptionManager.create({
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
    const task = TaskDescriptionManager.create({
      id: 5,
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
      // Test the static migration method indirectly by loading tasks with old data
      const task = TaskDescriptionManager.create({
        id: 6,
        title: 'Migration Test',
        description: 'Test description',
        inputs: new Map(),
        workflowName: 'swe',
      });

      // Test MERGED migration
      task.setStatus('MERGED' as TaskStatus);
      task.save();

      const reloadedTask = TaskDescriptionManager.load(6);
      expect(reloadedTask.status).toBe('MERGED');
      expect(reloadedTask.isMerged()).toBe(true);
    });
  });

  describe('utility methods', () => {
    it('should provide correct utility methods for new statuses', () => {
      const task = TaskDescriptionManager.create({
        id: 7,
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
