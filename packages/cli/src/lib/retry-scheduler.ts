import type { ProjectManager } from 'rover-core';
import { resumeTask } from './resume-helper.js';
import colors from 'ansi-colors';

/**
 * Calculate the next hourly retry window with attempt-based backoff.
 * `attempt` is the number of previous failures (0 = first try).
 *
 * The window is computed by snapping to the current hour boundary, then
 * advancing by 1h, 2h, 4h, 8h, 16h (capped at 24h), plus 2-10 min jitter.
 * This means the first retry may fire much sooner than 1 hour if the pause
 * happened late in the hour (e.g., paused at 14:59 → retry at ~15:02).
 *
 * Exported for testing.
 */
export function calculateNextRetryWindow(
  now: Date = new Date(),
  attempt: number = 0
): Date {
  const hoursToWait = Math.min(Math.pow(2, attempt), 24);
  const nextTime = new Date(now);
  nextTime.setUTCMinutes(0, 0, 0);
  // setUTCHours handles overflow (e.g. 25 → 1 AM next day) per the JS Date spec
  nextTime.setUTCHours(nextTime.getUTCHours() + hoursToWait);

  // Add random jitter between 2-10 minutes
  const jitterMinutes = 2 + Math.random() * 8;
  nextTime.setUTCMinutes(nextTime.getUTCMinutes() + Math.floor(jitterMinutes));
  nextTime.setUTCSeconds(Math.floor(Math.random() * 60));

  return nextTime;
}

/**
 * Maximum number of automatic retry cycles per task before giving up.
 * After this many failed resume attempts the task stays PAUSED and the
 * user must manually `rover resume <id>`.
 */
const MAX_AUTO_RETRIES = 5;

interface TaskTimerEntry {
  provider: string;
  taskId: number;
  project: ProjectManager;
  timer: NodeJS.Timeout;
  scheduledAt: Date;
}

/**
 * Per-task timers grouped by provider for display. Each paused task keeps its
 * own retry schedule so one task's backoff window does not delay or accelerate
 * another task from the same provider.
 *
 * NOTE: Auto-retry is only active while `rover list --watch` is running.
 * If the terminal session ends, scheduled retries are lost. Users can always
 * manually resume with `rover resume <taskId>`.
 */
export class RetryScheduler {
  private taskTimers: Map<string, TaskTimerEntry> = new Map();
  /** Tracks how many retry cycles each task has gone through. */
  private retryCounts: Map<string, number> = new Map();

  /** Separator that won't appear in file paths or numeric task IDs. */
  private static readonly KEY_SEP = '\0';

  private taskKey(project: ProjectManager, taskId: number): string {
    return `${project.path}${RetryScheduler.KEY_SEP}${taskId}`;
  }

  private clearTimer(taskKey: string): void {
    const entry = this.taskTimers.get(taskKey);
    if (entry) {
      clearTimeout(entry.timer);
      this.taskTimers.delete(taskKey);
    }
  }

  private clearTaskState(taskKey: string): void {
    this.clearTimer(taskKey);
    this.retryCounts.delete(taskKey);
  }

  /**
   * Register a paused task for automatic retry.
   * Each task gets its own timer based on its own retry count.
   */
  registerPausedTask(
    provider: string,
    taskId: number,
    project: ProjectManager
  ): void {
    const key = this.taskKey(project, taskId);

    const existing = this.taskTimers.get(key);
    if (existing) {
      if (existing.provider === provider) {
        return;
      }

      // Provider changed — reset state so the new provider gets a fresh
      // retry budget (different provider = different credit pool).
      this.clearTaskState(key);
    }

    const retryCount = this.retryCounts.get(key) ?? 0;
    if (retryCount >= MAX_AUTO_RETRIES) {
      console.log(
        colors.yellow(
          `  ⚠ Task ${taskId} reached max auto-retries (${MAX_AUTO_RETRIES}), use ${colors.cyan(`rover resume ${taskId}`)} to retry manually.`
        )
      );
      return;
    }

    const scheduledAt = calculateNextRetryWindow(new Date(), retryCount);
    const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      void this.fireRetry(key);
    }, delayMs);
    timer.unref();

    this.taskTimers.set(key, {
      provider,
      taskId,
      project,
      timer,
      scheduledAt,
    });

    console.log(
      colors.gray(
        `  ⏱ Auto-retry scheduled for ${provider} task ${taskId} at ${scheduledAt.toLocaleTimeString()}`
      )
    );
  }

  /**
   * Remove a task from the retry schedule (e.g., manually resumed).
   */
  unregisterTask(
    provider: string,
    taskId: number,
    project?: ProjectManager
  ): void {
    if (project) {
      this.clearTaskState(this.taskKey(project, taskId));
      return;
    }

    // Without a project, only clear timer entries matching both provider AND
    // taskId. We cannot safely clear retry counts keyed by project+taskId
    // because we might hit a same-numbered task in a different project.
    for (const [key, entry] of this.taskTimers.entries()) {
      if (entry.provider === provider && entry.taskId === taskId) {
        this.clearTimer(key);
      }
    }
  }

  /**
   * Get the next scheduled retry time for a provider.
   */
  getScheduledTime(provider: string): Date | undefined {
    let earliest: Date | undefined;

    for (const entry of this.taskTimers.values()) {
      if (entry.provider !== provider) continue;
      if (!earliest || entry.scheduledAt.getTime() < earliest.getTime()) {
        earliest = entry.scheduledAt;
      }
    }

    return earliest;
  }

  /**
   * Get the next scheduled retry time for a specific paused task.
   */
  getScheduledTimeForTask(
    project: ProjectManager,
    taskId: number
  ): Date | undefined {
    const entry = this.taskTimers.get(this.taskKey(project, taskId));
    return entry?.scheduledAt;
  }

  /**
   * Get the number of retry attempts for a task.
   */
  getRetryCount(project: ProjectManager, taskId: number): number {
    return this.retryCounts.get(this.taskKey(project, taskId)) ?? 0;
  }

  /**
   * Clean up all timers. Call on SIGINT / process exit.
   */
  destroy(): void {
    for (const entry of this.taskTimers.values()) {
      clearTimeout(entry.timer);
    }
    this.taskTimers.clear();
    this.retryCounts.clear();
  }

  /**
   * Internal: fires when an individual task's timer expires.
   */
  private async fireRetry(taskKey: string): Promise<void> {
    const entry = this.taskTimers.get(taskKey);
    if (!entry) return;

    this.taskTimers.delete(taskKey);

    const { provider, taskId, project } = entry;

    // Re-read task state before incrementing retry count to avoid inflating
    // the counter when the task was already resumed by another process.
    const task = project.getTask(taskId);
    if (!task || (!task.isPaused() && !task.isFailed())) {
      this.retryCounts.delete(taskKey);
      return;
    }

    console.log(
      colors.cyan(`\n🔄 Auto-retrying paused ${provider} task ${taskId}...`)
    );

    const attempt = (this.retryCounts.get(taskKey) ?? 0) + 1;
    this.retryCounts.set(taskKey, attempt);

    try {
      const result = await resumeTask(project, taskId);
      if (result.status === 'ok') {
        console.log(colors.green(`  ✓ Task ${taskId} resumed successfully`));
      } else if (result.status === 'already_resuming') {
        // Another process is handling it — don't count as a failure
        this.retryCounts.set(taskKey, attempt - 1);
        console.log(
          colors.gray(
            `  ℹ Task ${taskId} is already being resumed by another process`
          )
        );
      } else if (attempt >= MAX_AUTO_RETRIES) {
        console.log(
          colors.red(
            `  ✗ Task ${taskId} failed to resume after ${attempt} attempts, giving up. Use ${colors.cyan(`rover resume ${taskId}`)} to retry manually.`
          )
        );
      } else {
        console.log(
          colors.yellow(
            `  ⚠ Task ${taskId} could not be resumed (attempt ${attempt}/${MAX_AUTO_RETRIES}), re-scheduling...`
          )
        );
        this.registerPausedTask(provider, taskId, project);
      }
    } catch (error) {
      if (attempt >= MAX_AUTO_RETRIES) {
        console.log(
          colors.red(
            `  ✗ Task ${taskId} resume failed after ${attempt} attempts: ${error instanceof Error ? error.message : String(error)}. Use ${colors.cyan(`rover resume ${taskId}`)} to retry manually.`
          )
        );
      } else {
        console.log(
          colors.yellow(
            `  ⚠ Task ${taskId} resume failed (attempt ${attempt}/${MAX_AUTO_RETRIES}): ${error instanceof Error ? error.message : String(error)}, re-scheduling...`
          )
        );
        this.registerPausedTask(provider, taskId, project);
      }
    }
  }
}
