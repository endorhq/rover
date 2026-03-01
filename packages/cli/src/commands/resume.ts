import colors from 'ansi-colors';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { TaskNotFoundError } from 'rover-schemas';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';
import { getTelemetry } from '../lib/telemetry.js';
import {
  isJsonMode,
  setJsonMode,
  requireProjectContext,
} from '../lib/context.js';
import { resumeTask } from '../lib/resume-helper.js';
import type { CommandDefinition } from '../types.js';
import type { TaskResumeOutput } from '../output-types.js';

/**
 * Resume a task that is in PAUSED or FAILED status.
 *
 * Resumes a task that was paused due to credit limit exhaustion or other
 * retryable errors. Reuses the existing iteration directory and worktree,
 * and mounts the checkpoint.json file so the agent can skip completed steps.
 * Falls back to full restart behavior if no checkpoint is found.
 *
 * @param taskId - The numeric task ID to resume
 * @param options - Command options
 * @param options.json - Output results in JSON format
 */
const resumeCommand = async (
  taskId: string,
  options: { json?: boolean } = {}
) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const telemetry = getTelemetry();

  let jsonOutput: TaskResumeOutput = {
    success: false,
  };

  // Convert string taskId to number (strict: reject '123abc' etc.)
  if (!/^\d+$/.test(taskId)) {
    jsonOutput.error = `Invalid task ID '${taskId}' - must be a number`;
    await exitWithError(jsonOutput, { telemetry });
    return;
  }
  const numericTaskId = parseInt(taskId, 10);

  // Require project context
  let project;
  try {
    project = await requireProjectContext();
  } catch (error) {
    jsonOutput.error = error instanceof Error ? error.message : String(error);
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

  try {
    // Load task to display info before resuming
    const task = project.getTask(numericTaskId);
    if (!task) {
      throw new TaskNotFoundError(numericTaskId);
    }

    // Refresh status from the latest iteration when task.json is still active.
    // Keep explicit FAILED/PAUSED as-is so stale iteration status ("running")
    // cannot overwrite an orphaned task back into a non-resumable state.
    if (!task.isPaused() && !task.isFailed()) {
      task.updateStatusFromIteration();
    }

    // Check if task is in PAUSED or FAILED status
    if (!task.isPaused() && !task.isFailed()) {
      jsonOutput.error = `Task ${taskId} is not in PAUSED or FAILED status (current: ${task.status})`;
      await exitWithError(jsonOutput, {
        tips: [
          'Only PAUSED and FAILED tasks can be resumed',
          'Use ' +
            colors.cyan(`rover inspect ${taskId}`) +
            colors.gray(' to find out the current task status'),
        ],
        telemetry,
      });
      return;
    }

    // Display resume info
    const iterationPath = join(
      task.iterationsPath(),
      task.iterations.toString()
    );
    const checkpointPath = join(iterationPath, 'checkpoint.json');
    const hasCheckpoint = existsSync(checkpointPath);

    if (!hasCheckpoint && !isJsonMode()) {
      console.log(
        colors.yellow(
          '⚠ No checkpoint found - will run full workflow from start'
        )
      );
    }

    const resumedAt = new Date().toISOString();

    if (!isJsonMode()) {
      console.log(colors.bold('Resuming Task'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + task.title);
      console.log(colors.gray('├── Status: ') + colors.yellow(task.status));
      console.log(
        colors.gray('├── Workspace: ') +
          colors.cyan(task.worktreePath || 'will be created')
      );
      console.log(
        colors.gray('├── Branch: ') +
          colors.cyan(task.branchName || 'will be created')
      );
      console.log(
        colors.gray('├── Checkpoint: ') +
          (hasCheckpoint ? colors.green('found') : colors.yellow('not found'))
      );
      if (process.env.ROVER_AGENT_IMAGE) {
        console.log(
          colors.gray('├── Agent Image: ') +
            colors.cyan(process.env.ROVER_AGENT_IMAGE)
        );
      }
      console.log(
        colors.gray('└── Resuming to: ') + colors.yellow('IN_PROGRESS')
      );
      console.log('');
    }

    // Track resume event
    telemetry?.eventResumeTask();

    // Use the shared resume helper
    const success = await resumeTask(project, numericTaskId);

    if (!success) {
      jsonOutput.error = `Failed to resume task ${taskId}`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }

    // Reload task for updated status
    const updatedTask = project.getTask(numericTaskId);
    if (!updatedTask) {
      jsonOutput.error = `Task ${taskId} was removed during resume`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }

    // Output final JSON after all operations are complete
    jsonOutput = {
      ...jsonOutput,
      success: true,
      taskId: updatedTask.id,
      title: updatedTask.title,
      description: updatedTask.description,
      status: updatedTask.status,
      resumedAt,
    };

    await exitWithSuccess('Task resumed successfully!', jsonOutput, {
      tips: [
        'Use ' +
          colors.cyan('rover list --watch') +
          ' to monitor tasks and auto-retry paused tasks on credit reset',
        'Use ' +
          colors.cyan(`rover logs -f ${updatedTask.id}`) +
          ' to watch the task logs',
        'Use ' +
          colors.cyan(`rover inspect ${updatedTask.id}`) +
          ' to check the task status',
      ],
      telemetry,
    });

    return;
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = `The task with ID ${numericTaskId} was not found`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    } else {
      jsonOutput.error = `There was an error resuming the task: ${error}`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }
  } finally {
    await telemetry?.shutdown();
  }
};

// Named export for backwards compatibility (used by tests)
export { resumeCommand };

export default {
  name: 'resume',
  description: 'Resume a paused or failed task from checkpoint',
  requireProject: true,
  action: resumeCommand,
} satisfies CommandDefinition;
