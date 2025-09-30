import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { getTelemetry } from '../lib/telemetry.js';
import { showRoverChat } from '../utils/display.js';
import { statusColor } from '../utils/task-status.js';
import {
  exitWithErrors,
  exitWithSuccess,
  exitWithWarn,
} from '../utils/exit.js';
import { CLIJsonOutputWithErrors } from '../types.js';
import { findProjectRoot, git } from 'rover-common';

const { prompt } = enquirer;

/**
 * Interface for JSON output
 */
interface TaskDeleteOutput extends CLIJsonOutputWithErrors {}

export const deleteCommand = async (
  taskIds: string[],
  options: { json?: boolean; yes?: boolean } = {}
) => {
  const telemetry = getTelemetry();

  const json = options.json === true;
  const skipConfirmation = options.yes === true || json;
  const jsonOutput: TaskDeleteOutput = {
    success: false,
    errors: [],
  };

  // Convert string taskId to number
  const numericTaskIds: number[] = [];
  for (const taskId of taskIds) {
    const numericTaskId = parseInt(taskId, 10);
    if (isNaN(numericTaskId)) {
      jsonOutput.errors?.push(`Invalid task ID '${taskId}' - must be a number`);
    } else {
      numericTaskIds.push(numericTaskId);
    }
  }

  if (jsonOutput.errors.length > 0) {
    exitWithErrors(jsonOutput, json);
    return;
  }

  // Load all tasks and validate they exist
  const tasksToDelete: TaskDescription[] = [];
  const invalidTaskIds: number[] = [];

  for (const numericTaskId of numericTaskIds) {
    try {
      const task = await TaskDescription.load(numericTaskId);
      tasksToDelete.push(task);
    } catch (error) {
      if (error instanceof TaskNotFoundError) {
        invalidTaskIds.push(numericTaskId);
      } else {
        jsonOutput.errors?.push(
          `There was an error loading task ${numericTaskId}: ${error}`
        );
      }
    }
  }

  // If there are invalid task IDs, add them to errors
  if (invalidTaskIds.length > 0) {
    if (invalidTaskIds.length > 1) {
      jsonOutput.errors?.push(
        `Tasks with IDs ${invalidTaskIds.join(', ')} were not found`
      );
    } else {
      jsonOutput.errors?.push(
        `Task with ID ${invalidTaskIds[0]} was not found`
      );
    }
  }

  // Exit early if no valid tasks to delete
  if (tasksToDelete.length === 0) {
    jsonOutput.success = false;
    exitWithErrors(jsonOutput, json);
    await telemetry?.shutdown();
    return;
  }

  // Show tasks information and get single confirmation
  if (!json) {
    showRoverChat(["It's time to cleanup some tasks!"]);

    console.log(
      colors.white.bold(`Task${tasksToDelete.length > 1 ? 's' : ''} to delete`)
    );

    tasksToDelete.forEach((task, index) => {
      const colorFunc = statusColor(task.status);
      const isLast = index === tasksToDelete.length - 1;
      const prefix = isLast ? '└──' : '├──';

      console.log(
        colors.gray(`${prefix} ID: `) +
          colors.cyan(task.id.toString()) +
          colors.gray(' | Title: ') +
          colors.white(task.title) +
          colors.gray(' | Status: ') +
          colorFunc(task.status)
      );
    });

    console.log(
      '\n' +
        colors.white(
          `This action will delete the task${tasksToDelete.length > 1 ? 's' : ''} metadata and workspace${tasksToDelete.length > 1 ? 's' : ''} (git worktree${tasksToDelete.length > 1 ? 's' : ''})`
        )
    );
  }

  // Single confirmation for all tasks
  let confirmDeletion = true;
  if (!skipConfirmation) {
    try {
      const { confirm } = await prompt<{ confirm: boolean }>({
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete ${tasksToDelete.length > 1 ? 'these tasks' : 'this task'}?`,
        initial: false,
      });
      confirmDeletion = confirm;
    } catch (_err) {
      // User cancelled, exit without doing anything
      confirmDeletion = false;
    }
  }

  if (!confirmDeletion) {
    jsonOutput.errors?.push('Task deletion cancelled');
    exitWithErrors(jsonOutput, json);
    await telemetry?.shutdown();
    return;
  }

  // Process deletions
  const succeededTasks: number[] = [];
  const failedTasks: number[] = [];
  const warningTasks: number[] = [];

  try {
    for (const task of tasksToDelete) {
      try {
        const taskPath = join(
          await findProjectRoot(),
          '.rover',
          'tasks',
          task.id.toString()
        );

        // Delete the task
        telemetry?.eventDeleteTask();
        task.delete();
        rmSync(taskPath, { recursive: true, force: true });

        // Prune the git workspace
        try {
          await git.pruneWorktree();
          succeededTasks.push(task.id);
        } catch (error) {
          warningTasks.push(task.id);
          jsonOutput.errors?.push(
            `There was an error pruning task ${task.id.toString()} worktree: ${error}`
          );
        }
      } catch (error) {
        failedTasks.push(task.id);
        jsonOutput.errors?.push(
          `There was an error deleting task ${task.id}: ${error}`
        );
      }
    }
  } finally {
    // Determine overall success
    const allSucceeded = failedTasks.length === 0 && warningTasks.length === 0;
    const someSucceeded = succeededTasks.length > 0;

    jsonOutput.success = allSucceeded;

    if (allSucceeded) {
      exitWithSuccess(
        `All tasks (IDs: ${succeededTasks.join(' ')}) deleted successfully`,
        jsonOutput,
        json
      );
    } else if (someSucceeded) {
      exitWithWarn(
        `Some tasks (IDs: ${succeededTasks.join(' ')}) deleted successfully`,
        jsonOutput,
        json
      );
    } else {
      exitWithErrors(jsonOutput, json);
    }

    await telemetry?.shutdown();
  }
};
