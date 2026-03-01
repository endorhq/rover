import { existsSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import type { ProjectManager, TaskDescriptionManager } from 'rover-core';
import { VERBOSE } from 'rover-core';
import { AGENT_EXIT_CODE } from 'rover-schemas';
import { createSandbox } from './sandbox/index.js';

function isResumeLockHeld(task: TaskDescriptionManager): boolean {
  const iterationPath = join(task.iterationsPath(), task.iterations.toString());
  return existsSync(join(iterationPath, '.resume.lock'));
}

function isRestartStartupInFlight(task: TaskDescriptionManager): boolean {
  if (!task.lastRestartAt) return false;
  if (!task.runningAt) return true;

  return (
    new Date(task.runningAt).getTime() < new Date(task.lastRestartAt).getTime()
  );
}

/**
 * Detect tasks stuck as IN_PROGRESS or ITERATING whose container is no longer
 * running (e.g. after a crash or power-cycle) and transition them to FAILED so
 * that `rover resume` can recover them with checkpoint data intact.
 */
export async function detectOrphanedTasks(
  tasks: Array<{
    task: TaskDescriptionManager;
    project: ProjectManager | null;
  }>,
  options: { suppressWarnings?: boolean } = {}
): Promise<void> {
  const warn = options.suppressWarnings
    ? () => {}
    : (message: string) => {
        console.warn(message);
      };

  // Tasks with a container ID that we can inspect
  const candidates = tasks.filter(
    ({ task, project }) =>
      (task.isInProgress() || task.isIterating()) &&
      project != null &&
      task.containerId != null &&
      !isResumeLockHeld(task) &&
      !isRestartStartupInFlight(task)
  );

  if (candidates.length === 0) return;

  await Promise.allSettled(
    candidates.map(async ({ task, project }) => {
      try {
        const sandbox = await createSandbox(task, undefined, {
          projectPath: project!.path,
        });
        const state = await sandbox.inspect();

        if (!state) {
          task.markFailed(
            'Container exited unexpectedly (possible crash or system restart)'
          );
          warn(
            colors.yellow(
              `⚠ Task ${task.id} marked as FAILED — container is no longer running. Use "rover resume ${task.id}" to continue.`
            )
          );
          return;
        }

        const containerStatus = (state.status ?? '').toLowerCase();
        if (
          containerStatus === 'running' ||
          containerStatus === 'created' ||
          containerStatus === 'restarting'
        ) {
          return;
        }

        // Container exited — check exit code to distinguish clean exit from crash.
        // Exit code 0 means the workflow completed normally; the iteration status
        // file should already reflect this, so just refresh from disk.
        if (state.exitCode === AGENT_EXIT_CODE.SUCCESS) {
          task.updateStatusFromIteration();
          // If status is already terminal after refresh, nothing more to do.
          if (task.isCompleted() || task.isFailed() || task.isPaused()) {
            return;
          }
          // Exit code 0 is a clean exit — if the status file wasn't updated yet
          // (e.g., write still being flushed), force COMPLETED rather than
          // leaving the task in an active status with no running container.
          task.markCompleted();
          return;
        }

        // Exit code 2 means the agent paused (e.g. credit exhaustion).
        // The iteration status file should already say "paused", so read it.
        if (state.exitCode === AGENT_EXIT_CODE.PAUSED) {
          task.updateStatusFromIteration();
          if (task.isPaused() || task.isFailed()) {
            return;
          }
          // Status file wasn't written yet; mark PAUSED rather than FAILED
          // so the task is eligible for `rover resume` without manual intervention.
          task.markPaused(
            'Workflow paused due to retryable error (e.g. credit limit)'
          );
          return;
        }

        task.markFailed(
          'Container exited unexpectedly (possible crash or system restart)'
        );
        warn(
          colors.yellow(
            `⚠ Task ${task.id} marked as FAILED — container is no longer running. Use "rover resume ${task.id}" to continue.`
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warn(
          colors.yellow(
            `⚠ Could not inspect container for task ${task.id}, skipping orphan check: ${msg}`
          )
        );
      }
    })
  );
}
