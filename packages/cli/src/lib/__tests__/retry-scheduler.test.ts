import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RetryScheduler,
  calculateNextRetryWindow,
} from '../retry-scheduler.js';

// Mock the resume-helper module
vi.mock('../resume-helper.js', () => ({
  resumeTask: vi.fn(),
}));

import { resumeTask } from '../resume-helper.js';

const mockedResumeTask = vi.mocked(resumeTask);

describe('RetryScheduler', () => {
  let scheduler: RetryScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T14:00:00.000Z'));
    scheduler = new RetryScheduler();
    mockedResumeTask.mockReset();
  });

  afterEach(() => {
    scheduler.destroy();
    vi.useRealTimers();
  });

  describe('calculateNextRetryWindow', () => {
    it('returns a time in the next hourly window + 2-10 min jitter', () => {
      const now = new Date('2026-01-15T14:30:00.000Z');
      // Run multiple times to verify range
      for (let i = 0; i < 20; i++) {
        const result = calculateNextRetryWindow(now);
        // Should be in the 15:02-15:10 UTC range
        expect(result.getUTCHours()).toBe(15);
        expect(result.getUTCMinutes()).toBeGreaterThanOrEqual(2);
        expect(result.getUTCMinutes()).toBeLessThanOrEqual(10);
      }
    });

    it('wraps around midnight correctly', () => {
      const now = new Date('2026-01-15T23:45:00.000Z');
      const result = calculateNextRetryWindow(now);
      // Should be next day 00:02-00:10 UTC
      expect(result.getUTCDate()).toBe(16);
      expect(result.getUTCHours()).toBe(0);
      expect(result.getUTCMinutes()).toBeGreaterThanOrEqual(2);
      expect(result.getUTCMinutes()).toBeLessThanOrEqual(10);
    });

    it('moves the retry window forward for each attempt', () => {
      const now = new Date('2026-01-15T14:00:00.000Z');
      for (let i = 0; i < 20; i++) {
        // attempt 0: 1 hour → 15:02-15:10
        const r0 = calculateNextRetryWindow(now, 0);
        expect(r0.getUTCHours()).toBe(15);

        // attempt 1: 2 hours → 16:02-16:10
        const r1 = calculateNextRetryWindow(now, 1);
        expect(r1.getUTCHours()).toBe(16);

        // attempt 2: 4 hours → 18:02-18:10
        const r2 = calculateNextRetryWindow(now, 2);
        expect(r2.getUTCHours()).toBe(18);

        // attempt 3: 8 hours → 22:02-22:10
        const r3 = calculateNextRetryWindow(now, 3);
        expect(r3.getUTCHours()).toBe(22);

        // attempt 4: 16 hours → next day 06:02-06:10
        const r4 = calculateNextRetryWindow(now, 4);
        expect(r4.getUTCDate()).toBe(16);
        expect(r4.getUTCHours()).toBe(6);
      }
    });

    it('caps the retry window at 24 hours', () => {
      const now = new Date('2026-01-15T14:00:00.000Z');
      // attempt 10: 2^10 = 1024 hours, capped at 24
      const result = calculateNextRetryWindow(now, 10);
      const diffHours = (result.getTime() - now.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThanOrEqual(24);
      expect(diffHours).toBeLessThanOrEqual(25);
    });

    it('snaps late-hour retries into the next hourly window instead of waiting a full hour', () => {
      const now = new Date('2026-01-15T14:59:00.000Z');
      const result = calculateNextRetryWindow(now, 0);

      expect(result.getUTCHours()).toBe(15);
      expect(result.getUTCMinutes()).toBeGreaterThanOrEqual(2);
      expect(result.getUTCMinutes()).toBeLessThanOrEqual(10);
    });
  });

  /** Helper to create a mock project with getTask returning a resumable task. */
  function makeMockProject(path = '/tmp/project', taskStatus = 'PAUSED'): any {
    return {
      path,
      getTask: vi.fn().mockReturnValue({
        status: taskStatus,
        isPaused: () => taskStatus === 'PAUSED',
        isFailed: () => taskStatus === 'FAILED',
      }),
    };
  }

  describe('registerPausedTask', () => {
    it('creates a new timer for a new provider', () => {
      const mockProject = makeMockProject();
      scheduler.registerPausedTask('claude', 1, mockProject);

      const scheduledTime = scheduler.getScheduledTime('claude');
      expect(scheduledTime).toBeDefined();
      expect(scheduledTime!.getTime()).toBeGreaterThan(Date.now());
    });

    it('updates the provider retry time when a newly added task is scheduled earlier', () => {
      const mockProject = makeMockProject();
      const randomSpy = vi
        .spyOn(Math, 'random')
        .mockReturnValueOnce(0.99)
        .mockReturnValueOnce(0.99)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0);

      scheduler.registerPausedTask('claude', 1, mockProject);
      const firstScheduledTime = scheduler.getScheduledTime('claude');

      scheduler.registerPausedTask('claude', 2, mockProject);
      const secondScheduledTime = scheduler.getScheduledTime('claude');

      expect(firstScheduledTime).toBeDefined();
      expect(secondScheduledTime).toBeDefined();
      expect(secondScheduledTime!.getTime()).toBeLessThan(
        firstScheduledTime!.getTime()
      );

      randomSpy.mockRestore();
    });

    it('creates separate timers for different providers', () => {
      const mockProject = makeMockProject();
      scheduler.registerPausedTask('claude', 1, mockProject);
      scheduler.registerPausedTask('gemini', 2, mockProject);

      expect(scheduler.getScheduledTime('claude')).toBeDefined();
      expect(scheduler.getScheduledTime('gemini')).toBeDefined();
    });

    it('returns task-specific scheduled times for paused tasks', () => {
      const mockProject = makeMockProject();
      scheduler.registerPausedTask('claude', 1, mockProject);
      scheduler.registerPausedTask('claude', 2, mockProject);

      expect(scheduler.getScheduledTimeForTask(mockProject, 1)).toBeDefined();
      expect(scheduler.getScheduledTimeForTask(mockProject, 2)).toBeDefined();
      expect(
        scheduler.getScheduledTimeForTask(mockProject, 999)
      ).toBeUndefined();
    });

    it('correctly tracks tasks from projects with colons in path', () => {
      const projectA = makeMockProject('/tmp/C:/Users/projectA');
      const projectB = makeMockProject('/home/user:name/project:B');

      scheduler.registerPausedTask('claude', 1, projectA);
      scheduler.registerPausedTask('claude', 2, projectB);

      expect(scheduler.getRetryCount(projectA, 1)).toBe(0);
      expect(scheduler.getRetryCount(projectB, 2)).toBe(0);
      expect(scheduler.getScheduledTime('claude')).toBeDefined();
    });

    it('resets retry backoff immediately when provider changes', async () => {
      const mockProject = makeMockProject();
      mockedResumeTask.mockResolvedValue({
        status: 'failed',
        error: 'still paused',
      });

      scheduler.registerPausedTask('claude', 1, mockProject);
      await vi.advanceTimersToNextTimerAsync();

      expect(scheduler.getRetryCount(mockProject, 1)).toBe(1);

      scheduler.registerPausedTask('gemini', 1, mockProject);

      expect(scheduler.getRetryCount(mockProject, 1)).toBe(0);
      const scheduled = scheduler.getScheduledTime('gemini');
      expect(scheduled).toBeDefined();
      // Attempt 0 should schedule in the next hour window, not attempt 1 (+2h).
      expect(scheduled!.getUTCHours()).toBe(16);
    });
  });

  describe('unregisterTask', () => {
    it('removes a task from the provider group', () => {
      const mockProject = makeMockProject();
      scheduler.registerPausedTask('claude', 1, mockProject);
      scheduler.registerPausedTask('claude', 2, mockProject);

      scheduler.unregisterTask('claude', 1, mockProject);

      // Timer should still exist (task 2 remains)
      expect(scheduler.getScheduledTime('claude')).toBeDefined();
    });

    it('clears timer when last task for provider is removed', () => {
      const mockProject = makeMockProject();
      scheduler.registerPausedTask('claude', 1, mockProject);

      scheduler.unregisterTask('claude', 1, mockProject);

      expect(scheduler.getScheduledTime('claude')).toBeUndefined();
    });

    it('handles unregistering non-existent provider gracefully', () => {
      expect(() => scheduler.unregisterTask('nonexistent', 1)).not.toThrow();
    });

    it('clears retry count when a task leaves the paused state', async () => {
      const mockProject = makeMockProject();
      mockedResumeTask.mockResolvedValue({
        status: 'failed',
        error: 'still paused',
      });

      scheduler.registerPausedTask('claude', 1, mockProject);
      await vi.advanceTimersToNextTimerAsync();

      expect(scheduler.getRetryCount(mockProject, 1)).toBe(1);

      scheduler.unregisterTask('claude', 1, mockProject);

      expect(scheduler.getRetryCount(mockProject, 1)).toBe(0);
      expect(scheduler.getScheduledTime('claude')).toBeUndefined();
    });

    it('removes only the matching project task when task ids collide', async () => {
      const projectA = makeMockProject('/tmp/project-a');
      const projectB = makeMockProject('/tmp/project-b');
      mockedResumeTask.mockResolvedValue({ status: 'ok' });

      scheduler.registerPausedTask('claude', 1, projectA);
      scheduler.registerPausedTask('claude', 1, projectB);

      scheduler.unregisterTask('claude', 1, projectA);

      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

      expect(mockedResumeTask).toHaveBeenCalledTimes(1);
      expect(mockedResumeTask).toHaveBeenCalledWith(projectB, 1);
    });

    it('handles project paths containing colons', async () => {
      const colonProject = makeMockProject('/tmp/C:/Users/test');
      mockedResumeTask.mockResolvedValue({
        status: 'failed',
        error: 'still paused',
      });

      scheduler.registerPausedTask('claude', 1, colonProject);
      await vi.advanceTimersToNextTimerAsync();

      expect(scheduler.getRetryCount(colonProject, 1)).toBe(1);

      // Unregister without project only clears the timer, not retry counts
      // (to avoid cross-project collisions when project is unknown).
      scheduler.unregisterTask('claude', 1);

      expect(scheduler.getRetryCount(colonProject, 1)).toBe(1);
      expect(scheduler.getScheduledTime('claude')).toBeUndefined();
    });

    it('does not clear retry counts without project to prevent cross-project collisions', async () => {
      const colonProject = makeMockProject('/tmp/C:/Users/test');
      mockedResumeTask.mockResolvedValue({
        status: 'failed',
        error: 'still paused',
      });

      scheduler.registerPausedTask('claude', 1, colonProject);

      // Exhaust retries so the timer is no longer scheduled but retry count remains.
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersToNextTimerAsync();
      }

      expect(scheduler.getRetryCount(colonProject, 1)).toBe(5);
      expect(scheduler.getScheduledTime('claude')).toBeUndefined();

      // Unregister without project reference — retry counts are preserved
      // because we cannot determine the correct project key.
      scheduler.unregisterTask('claude', 1);

      expect(scheduler.getRetryCount(colonProject, 1)).toBe(5);
    });

    it('handles project paths with multiple colons', () => {
      const multiColonProject = makeMockProject('/path:with:many:colons');

      scheduler.registerPausedTask('claude', 1, multiColonProject);

      expect(scheduler.getScheduledTime('claude')).toBeDefined();

      scheduler.unregisterTask('claude', 1, multiColonProject);

      expect(scheduler.getScheduledTime('claude')).toBeUndefined();
    });

    it('resets a later pause episode back to retry count zero', async () => {
      const mockProject = makeMockProject();
      mockedResumeTask.mockResolvedValue({
        status: 'failed',
        error: 'still paused',
      });

      scheduler.registerPausedTask('claude', 1, mockProject);
      await vi.advanceTimersToNextTimerAsync();

      expect(scheduler.getRetryCount(mockProject, 1)).toBe(1);

      scheduler.unregisterTask('claude', 1, mockProject);
      scheduler.registerPausedTask('claude', 1, mockProject);

      expect(scheduler.getRetryCount(mockProject, 1)).toBe(0);
    });
  });

  describe('getScheduledTime', () => {
    it('returns undefined for unregistered provider', () => {
      expect(scheduler.getScheduledTime('claude')).toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('clears all timers', () => {
      const mockProject = makeMockProject();
      scheduler.registerPausedTask('claude', 1, mockProject);
      scheduler.registerPausedTask('gemini', 2, mockProject);

      scheduler.destroy();

      expect(scheduler.getScheduledTime('claude')).toBeUndefined();
      expect(scheduler.getScheduledTime('gemini')).toBeUndefined();
    });
  });

  describe('timer firing', () => {
    it('calls resumeTask for all registered tasks when timer fires', async () => {
      const mockProject = makeMockProject();
      mockedResumeTask.mockResolvedValue({ status: 'ok' });

      scheduler.registerPausedTask('claude', 1, mockProject);
      scheduler.registerPausedTask('claude', 2, mockProject);

      // Advance time past the scheduled retry
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000); // 2 hours

      expect(mockedResumeTask).toHaveBeenCalledTimes(2);
      expect(mockedResumeTask).toHaveBeenCalledWith(mockProject, 1);
      expect(mockedResumeTask).toHaveBeenCalledWith(mockProject, 2);

      // Timer should be cleared after firing
      expect(scheduler.getScheduledTime('claude')).toBeUndefined();
    });

    it('re-registers tasks that fail to resume', async () => {
      const mockProject = makeMockProject();
      mockedResumeTask.mockResolvedValue({
        status: 'failed',
        error: 'still paused',
      });

      scheduler.registerPausedTask('claude', 1, mockProject);

      // Advance to fire only the first timer (not the re-registered one)
      await vi.advanceTimersToNextTimerAsync();

      expect(mockedResumeTask).toHaveBeenCalledTimes(1);

      // Should be re-registered with a new timer
      expect(scheduler.getScheduledTime('claude')).toBeDefined();
    });

    it('re-registers tasks that throw errors during resume', async () => {
      const mockProject = makeMockProject();
      mockedResumeTask.mockRejectedValue(new Error('Container failed'));

      scheduler.registerPausedTask('claude', 1, mockProject);

      // Advance to fire only the first timer (not the re-registered one)
      await vi.advanceTimersToNextTimerAsync();

      expect(mockedResumeTask).toHaveBeenCalledTimes(1);

      // Should be re-registered for next hour
      expect(scheduler.getScheduledTime('claude')).toBeDefined();
    });

    it('stops retrying after max attempts (5) on persistent failure', async () => {
      const mockProject = makeMockProject();
      mockedResumeTask.mockResolvedValue({
        status: 'failed',
        error: 'still paused',
      });

      scheduler.registerPausedTask('claude', 1, mockProject);

      // Fire 5 retry cycles
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersToNextTimerAsync();
      }

      expect(mockedResumeTask).toHaveBeenCalledTimes(5);

      // After 5 failures, should NOT be re-registered
      expect(scheduler.getScheduledTime('claude')).toBeUndefined();
    });

    it('stops retrying after max attempts on persistent errors', async () => {
      const mockProject = makeMockProject();
      mockedResumeTask.mockRejectedValue(new Error('Docker broken'));

      scheduler.registerPausedTask('claude', 1, mockProject);

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersToNextTimerAsync();
      }

      expect(mockedResumeTask).toHaveBeenCalledTimes(5);
      expect(scheduler.getScheduledTime('claude')).toBeUndefined();
    });

    it('does not re-register a task after it has reached the retry cap', async () => {
      const mockProject = makeMockProject();
      mockedResumeTask.mockResolvedValue({
        status: 'failed',
        error: 'still paused',
      });

      scheduler.registerPausedTask('claude', 1, mockProject);

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersToNextTimerAsync();
      }

      scheduler.registerPausedTask('claude', 1, mockProject);

      expect(mockedResumeTask).toHaveBeenCalledTimes(5);
      expect(scheduler.getScheduledTime('claude')).toBeUndefined();
    });

    it('logs a message when registration is skipped due to max retries', async () => {
      const mockProject = makeMockProject();
      mockedResumeTask.mockResolvedValue({
        status: 'failed',
        error: 'still paused',
      });

      scheduler.registerPausedTask('claude', 1, mockProject);

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersToNextTimerAsync();
      }

      const logSpy = vi.spyOn(console, 'log');
      scheduler.registerPausedTask('claude', 1, mockProject);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('max auto-retries')
      );
      logSpy.mockRestore();
    });

    it('preserves retry count on successful resume to prevent rapid re-pause bypass', async () => {
      const mockProject = makeMockProject();

      // Fail twice, then succeed
      mockedResumeTask
        .mockResolvedValueOnce({ status: 'failed', error: 'still paused' })
        .mockResolvedValueOnce({ status: 'failed', error: 'still paused' })
        .mockResolvedValueOnce({ status: 'ok' });

      scheduler.registerPausedTask('claude', 1, mockProject);

      // Fire 3 retry cycles
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersToNextTimerAsync();
      }

      expect(mockedResumeTask).toHaveBeenCalledTimes(3);
      // Retry count is preserved after success so a rapid re-pause
      // cannot bypass the MAX_AUTO_RETRIES limit.
      expect(scheduler.getRetryCount(mockProject, 1)).toBe(3);
    });

    it('keeps backoff independent for tasks from the same provider', async () => {
      const mockProject = makeMockProject();

      mockedResumeTask
        .mockResolvedValueOnce({ status: 'failed', error: 'still paused' })
        .mockResolvedValue({ status: 'ok' });

      scheduler.registerPausedTask('claude', 1, mockProject);
      await vi.advanceTimersToNextTimerAsync();

      const backedOffRetry = scheduler.getScheduledTime('claude');
      expect(backedOffRetry).toBeDefined();

      scheduler.registerPausedTask('claude', 2, mockProject);
      const providerScheduledTime = scheduler.getScheduledTime('claude');

      expect(providerScheduledTime).toBeDefined();
      expect(providerScheduledTime!.getTime()).toBeLessThan(
        backedOffRetry!.getTime()
      );

      await vi.advanceTimersToNextTimerAsync();

      expect(mockedResumeTask).toHaveBeenNthCalledWith(2, mockProject, 2);
      expect(scheduler.getRetryCount(mockProject, 1)).toBe(1);
      // Retry count preserved after success (count = 1 from the single fire)
      expect(scheduler.getRetryCount(mockProject, 2)).toBe(1);
    });
  });
});
