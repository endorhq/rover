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
import Git from '../lib/git.js';

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
  const git = new Git();

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
      exitWithErrors(jsonOutput, json);
      return; // Add explicit return to prevent further execution
    }
    numericTaskIds.push(numericTaskId);
  }

  let allSucceeded = true;
  let someSucceeded = false;
  let someConfirmed = false;
  try {
    for (const numericTaskId of numericTaskIds) {
      try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);
        const taskPath = join(
          process.cwd(),
          '.rover',
          'tasks',
          numericTaskId.toString()
        );

        if (!json) {
          showRoverChat(["It's time to cleanup some tasks!"]);

          const colorFunc = statusColor(task.status);

          console.log(colors.white.bold('Task to delete'));
          console.log(
            colors.gray('├── ID: ') + colors.cyan(task.id.toString())
          );
          console.log(colors.gray('├── Title: ') + colors.white(task.title));
          console.log(
            colors.gray('└── Status: ') + colorFunc(task.status) + '\n'
          );

          console.log(
            colors.white(
              'This action will delete the task metadata and workspace (git worktree)'
            )
          );
        }

        // Confirm deletion
        let confirmDeletion = true;

        if (!skipConfirmation) {
          try {
            const { confirm } = await prompt<{ confirm: boolean }>({
              type: 'confirm',
              name: 'confirm',
              message: 'Are you sure you want to delete this task?',
              initial: false,
            });
            confirmDeletion = confirm;
            if (confirm) {
              someConfirmed = true;
            }
          } catch (_err) {
            jsonOutput.errors?.push(
              `Task ${task.id.toString()} deletion cancelled`
            );
          }
        } else {
          someConfirmed = true;
        }

        if (confirmDeletion) {
          // Create backup before deletion
          telemetry?.eventDeleteTask();
          task.delete();
          rmSync(taskPath, { recursive: true, force: true });

          // Prune the git workspace
          const prune = git.pruneWorktree();

          if (prune) {
            someSucceeded = true;
          } else {
            allSucceeded = false;
            if (!json) {
              console.log(
                colors.yellow(
                  '⚠ There was an error pruning the git worktrees.'
                )
              );
            }
            jsonOutput.errors?.push(
              `There was an error pruning task ${task.id.toString()} worktree`
            );
          }
        } else {
          jsonOutput.errors?.push(
            `Task ${task.id.toString()} deletion cancelled`
          );
        }
      } catch (error) {
        allSucceeded = false;
        if (error instanceof TaskNotFoundError) {
          jsonOutput.errors?.push(
            `The task with ID ${numericTaskId} was not found`
          );
        } else {
          jsonOutput.errors?.push(
            `There was an error deleting the task: ${error}`
          );
        }
      }
    }
  } finally {
    jsonOutput.success = allSucceeded;
    if (allSucceeded && someConfirmed) {
      exitWithSuccess('Task(s) deleted successfully', jsonOutput, json);
    } else if (someSucceeded && !someConfirmed) {
      exitWithSuccess(
        'No task was deleted as none was confirmed',
        jsonOutput,
        json
      );
    } else if (someSucceeded) {
      exitWithWarn('Some task(s) deleted successfully', jsonOutput, json);
    } else {
      exitWithErrors(jsonOutput, json);
    }

    await telemetry?.shutdown();
  }
};
