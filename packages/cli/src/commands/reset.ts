import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  launchSync,
  showTitle,
  showProperties,
  showList,
  type ProjectManager,
} from 'rover-core';
import yoctoSpinner from 'yocto-spinner';
import { TaskNotFoundError } from 'rover-schemas';
import { getTelemetry } from '../lib/telemetry.js';
import { exitWithError, exitWithWarn, exitWithSuccess } from '../utils/exit.js';
import { requireProjectContext } from '../lib/context.js';
import type { CommandDefinition } from '../types.js';

const { prompt } = enquirer;

/**
 * Reset a task to its initial state, removing all progress.
 *
 * Completely resets a task by removing its git worktree, branch, and any
 * iteration data. This is a destructive operation that cannot be undone.
 * Useful for starting fresh when a task has gone off track or when the
 * workspace needs to be recreated.
 *
 * @param taskId - The numeric task ID to reset
 * @param options - Command options
 * @param options.force - Skip confirmation prompt
 */
const resetCommand = async (
  taskId: string,
  options: { force?: boolean } = {}
) => {
  const telemetry = getTelemetry();
  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    await exitWithError(
      {
        success: false,
        error: `Invalid task ID '${taskId}' - must be a number`,
      },
      { telemetry }
    );
    return;
  }

  // Require project context
  let project: ProjectManager;
  try {
    project = await requireProjectContext();
  } catch (error) {
    await exitWithError(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { telemetry }
    );
    return;
  }

  try {
    // Load task using ProjectManager
    const task = project.getTask(numericTaskId);
    if (!task) {
      throw new TaskNotFoundError(numericTaskId);
    }
    const taskPath = project.getTaskPath(numericTaskId);

    showTitle('🔄 Reset Task');

    const props: Record<string, string> = {
      ID: colors.cyan(taskId),
      Title: task.title,
      Status: colors.yellow(task.status),
    };
    if (existsSync(task.worktreePath)) {
      props['Workspace'] = colors.cyan(task.worktreePath);
    }
    if (task.branchName) {
      props['Branch'] = colors.cyan(task.branchName);
    }
    showProperties(props);

    showList(
      [
        colors.red('Reset task status to NEW'),
        colors.red('Remove the git workspace'),
        colors.red('Remove the iterations metadata'),
        colors.red('Delete the git branch'),
        colors.red('Clear all execution metadata'),
      ],
      { title: colors.red('This will:'), addLineBreak: true }
    );

    // Confirm reset unless force flag is used
    if (!options.force) {
      const { confirm } = await prompt<{ confirm: boolean }>({
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to reset this task?',
        initial: false,
      });

      if (!confirm) {
        await exitWithWarn(
          'Task reset cancelled',
          { success: true },
          { telemetry }
        );
        return;
      }
    }

    const spinner = yoctoSpinner({ text: 'Resetting task...' }).start();

    telemetry?.eventReset();

    try {
      // Check if we're in a git repository
      launchSync('git', ['rev-parse', '--is-inside-work-tree']);

      // Remove git workspace if it exists
      if (task.worktreePath) {
        try {
          launchSync('git', [
            'worktree',
            'remove',
            task.worktreePath,
            '--force',
          ]);
          spinner.text = 'Workspace removed';
        } catch (error) {
          // If workspace removal fails, try to remove it manually
          try {
            rmSync(task.worktreePath, { recursive: true, force: true });
            // Remove worktree from git's tracking
            launchSync('git', ['worktree', 'prune']);
          } catch (manualError) {
            console.warn(
              colors.yellow('Warning: Could not remove workspace directory')
            );
          }
        }
      }

      // Remove git branch if it exists
      if (task.branchName) {
        try {
          // Check if branch exists
          launchSync('git', [
            'show-ref',
            '--verify',
            '--quiet',
            `refs/heads/${task.branchName}`,
          ]);
          // Delete the branch
          launchSync('git', ['branch', '-D', task.branchName]);
          spinner.text = 'Branch removed';
        } catch (error) {
          // Branch doesn't exist or couldn't be deleted, which is fine
        }
      }
    } catch (error) {
      // Not in a git repository, skip git operations
    }

    // Delete the iterations
    const iterationPath = join(taskPath, 'iterations');
    rmSync(iterationPath, { recursive: true, force: true });

    // Reset task to original state using existing TaskDescription instance
    task.setStatus('NEW');
    task.setWorkspace('', ''); // Clear workspace information

    spinner.success('Task reset successfully');

    console.log(colors.green('\n✓ Task has been reset to original state'));
    console.log(colors.gray('  Status: ') + colors.cyan('NEW'));
    console.log(colors.gray('  All execution metadata cleared'));
    console.log(colors.gray('  Workspace and branch removed'));

    await exitWithSuccess(
      'Task has been reset to original state',
      { success: true },
      { telemetry }
    );
    return;
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      await exitWithError(
        { success: false, error: error.message },
        { telemetry }
      );
    } else {
      await exitWithError(
        { success: false, error: `Error resetting task: ${error}` },
        { telemetry }
      );
    }
  }
};

export default {
  name: 'reset',
  description: 'Reset a task to original state and remove any worktree/branch',
  requireProject: true,
  action: resetCommand,
} satisfies CommandDefinition;
