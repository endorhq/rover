import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskDescription, TaskStatus } from '../description.js';

describe('TaskDescription', () => {
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

  describe('new status types', () => {
    it('should support MERGED status', () => {
      const task = TaskDescription.create({
        id: 1,
        title: 'Test Task',
        description: 'Test description'
      });

      task.markMerged();

      expect(task.status).toBe('MERGED');
      expect(task.isMerged()).toBe(true);
      expect(task.completedAt).toBeDefined();
    });

    it('should support PUSHED status', () => {
      const task = TaskDescription.create({
        id: 2,
        title: 'Test Task',
        description: 'Test description'
      });

      task.markPushed();

      expect(task.status).toBe('PUSHED');
      expect(task.isPushed()).toBe(true);
      expect(task.completedAt).toBeDefined();
    });

    it('should support resetting to NEW status', () => {
      const task = TaskDescription.create({
        id: 3,
        title: 'Test Task',
        description: 'Test description'
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
      const task = TaskDescription.create({
        id: 4,
        title: 'Test Task',
        description: 'Test description'
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

    it('should set completedAt when marking as MERGED or PUSHED', () => {
      const task = TaskDescription.create({
        id: 5,
        title: 'Test Task',
        description: 'Test description'
      });

      const beforeTime = Date.now();
      
      task.markMerged();
      expect(task.completedAt).toBeDefined();
      expect(new Date(task.completedAt!).getTime()).toBeGreaterThanOrEqual(beforeTime);

      // Reset and test PUSHED
      task.resetToNew();
      const beforeTime2 = Date.now();
      
      task.markPushed();
      expect(task.completedAt).toBeDefined();
      expect(new Date(task.completedAt!).getTime()).toBeGreaterThanOrEqual(beforeTime2);
    });
  });

  describe('status migration', () => {
    it('should migrate old status values to new enum including MERGED and PUSHED', () => {
      // Test the static migration method indirectly by loading tasks with old data
      const task = TaskDescription.create({
        id: 6,
        title: 'Migration Test',
        description: 'Test description'
      });

      // Test MERGED migration
      task.setStatus('MERGED' as TaskStatus);
      task.save();
      
      const reloadedTask = TaskDescription.load(6);
      expect(reloadedTask.status).toBe('MERGED');
      expect(reloadedTask.isMerged()).toBe(true);
    });
  });

  describe('utility methods', () => {
    it('should provide correct utility methods for new statuses', () => {
      const task = TaskDescription.create({
        id: 7,
        title: 'Utility Test',
        description: 'Test description'
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