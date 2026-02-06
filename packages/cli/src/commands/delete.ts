import colors from 'ansi-colors';
import enquirer from 'enquirer';
import {
  Git,
  type TaskDescriptionManager,
  type ProjectManager,
} from 'rover-core';
import { getTelemetry } from '../lib/telemetry.js';
import { showRoverChat } from '../utils/display.js';
import { statusColor } from '../utils/task-status.js';
import {
  exitWithErrors,
  exitWithSuccess,
  exitWithWarn,
} from '../utils/exit.js';
import type { TaskDeleteOutput } from '../output-types.js';
import {
  isJsonMode,
  setJsonMode,
  requireProjectContext,
} from '../lib/context.js';
import type { CommandDefinition } from '../types.js';

const { prompt } = enquirer;

/**
 * Delete one or more tasks from a Rover project.
 *
 * This command permanently removes task metadata and associated git worktrees.
 * It validates task IDs, shows a summary of tasks to be deleted, and prompts
 * for confirmation before proceeding (unless --yes flag is used).
 *
 * @param taskIds - Array of task ID strings to delete
 * @param options - Command options
 * @param options.json - Output results in JSON format
 * @param options.yes - Skip confirmation prompt
 */
const deleteCommand = async (
  taskIds: string[],
  options: { json?: boolean; yes?: boolean } = {}
) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

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
    if (Number.isNaN(numericTaskId)) {
      jsonOutput.errors?.push(`Invalid task ID '${taskId}' - must be a number`);
    } else {
      numericTaskIds.push(numericTaskId);
    }
  }

  if (jsonOutput.errors.length > 0) {
    await exitWithErrors(jsonOutput, { telemetry });
    return;
  }

  // Require project context
  let project: ProjectManager;
  try {
    project = await requireProjectContext();
  } catch (error) {
    jsonOutput.errors?.push(
      error instanceof Error ? error.message : String(error)
    );
    await exitWithErrors(jsonOutput, { telemetry });
    return;
  }

  // Load all tasks and validate they exist
  const tasksToDelete: TaskDescriptionManager[] = [];
  const invalidTaskIds: number[] = [];

  for (const numericTaskId of numericTaskIds) {
    const task = project.getTask(numericTaskId);
    if (task) {
      tasksToDelete.push(task);
    } else {
      invalidTaskIds.push(numericTaskId);
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
    await exitWithErrors(jsonOutput, { telemetry });
    await telemetry?.shutdown();
    return;
  }

  // Show tasks information and get single confirmation
  if (!isJsonMode()) {
    showRoverChat(["It's time to cleanup some tasks!"]);

    console.log(
      colors.bold(`Task${tasksToDelete.length > 1 ? 's' : ''} to delete`)
    );

    tasksToDelete.forEach((task, index) => {
      const colorFunc = statusColor(task.status);
      const isLast = index === tasksToDelete.length - 1;
      const prefix = isLast ? '└──' : '├──';

      console.log(
        colors.gray(`${prefix} ID: `) +
          colors.cyan(task.id.toString()) +
          colors.gray(' | Title: ') +
          task.title +
          colors.gray(' | Status: ') +
          colorFunc(task.status)
      );
    });

    console.log(
      '\n' +
        `This action will delete the task${tasksToDelete.length > 1 ? 's' : ''} metadata and workspace${tasksToDelete.length > 1 ? 's' : ''} (git worktree${tasksToDelete.length > 1 ? 's' : ''})`
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
    await exitWithErrors(jsonOutput, { telemetry });
    await telemetry?.shutdown();
    return;
  }

  // Initialize Git with project path
  const git = new Git({ cwd: project.path });

  // Process deletions
  const succeededTasks: number[] = [];
  const failedTasks: number[] = [];
  const warningTasks: number[] = [];

  try {
    for (const task of tasksToDelete) {
      try {
        // Delete the task using ProjectManager
        telemetry?.eventDeleteTask();
        project.deleteTask(task);

        // Prune the git workspace
        const prune = git.pruneWorktree();

        if (prune) {
          succeededTasks.push(task.id);
        } else {
          warningTasks.push(task.id);
          jsonOutput.errors?.push(
            `There was an error pruning task ${task.id.toString()} worktree`
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
      await exitWithSuccess(
        `All tasks (IDs: ${succeededTasks.join(' ')}) deleted successfully`,
        jsonOutput,
        { telemetry }
      );
    } else if (someSucceeded) {
      await exitWithWarn(
        `Some tasks (IDs: ${succeededTasks.join(' ')}) deleted successfully`,
        jsonOutput,
        { telemetry }
      );
    } else {
      await exitWithErrors(jsonOutput, { telemetry });
    }

    await telemetry?.shutdown();
  }
};

// Named export for backwards compatibility (used by tests)
export { deleteCommand };

export default {
  name: 'delete',
  description: 'Delete a task',
  requireProject: true,
  action: deleteCommand,
} satisfies CommandDefinition;
