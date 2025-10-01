import colors from 'ansi-colors';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { findProjectRoot, launchSync } from 'rover-common';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';
import { CLIJsonOutput } from '../types.js';
import { getTelemetry } from '../lib/telemetry.js';
import yoctoSpinner from 'yocto-spinner';

/**
 * Interface for JSON output
 */
interface TaskStopOutput extends CLIJsonOutput {
  taskId?: number;
  title?: string;
  status?: string;
  stoppedAt?: string;
}

/**
 * Stop a running task and clean up its resources
 */
export const stopCommand = async (
  taskId: string,
  options: {
    json?: boolean;
    removeAll?: boolean;
    removeContainer?: boolean;
    removeGitWorktreeAndBranch?: boolean;
  } = {}
) => {
  const telemetry = getTelemetry();

  // Track stop task event
  telemetry?.eventStopTask();

  const json = options.json === true;
  let jsonOutput: TaskStopOutput = {
    success: false,
  };

  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    jsonOutput.error = `Invalid task ID '${taskId}' - must be a number`;
    exitWithError(jsonOutput, json);
    return;
  }

  try {
    // Load task using TaskDescription
    const task = TaskDescription.load(numericTaskId);

    if (!json) {
      console.log(colors.bold('Stopping Task'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + task.title);
      console.log(colors.gray('└── Status: ') + colors.yellow(task.status));
    }

    const spinner = !json
      ? yoctoSpinner({ text: 'Stopping task...' }).start()
      : null;

    // Stop Docker container if it exists and is running
    if (task.containerId) {
      try {
        launchSync('docker', ['stop', task.containerId]);
        if (spinner) spinner.text = 'Container stopped';
        if (!json) {
          console.log(colors.green('✓ Container stopped'));
        }
      } catch (error) {
        // Container might already be stopped or removed, continue with cleanup
        if (!json) {
          console.log(
            colors.yellow('⚠ Container was already stopped or removed')
          );
        }
      }

      // Try to remove the container
      if (options.removeAll || options.removeContainer) {
        try {
          launchSync('docker', ['rm', '-f', task.containerId]);
          if (spinner) spinner.text = 'Container removed';
        } catch (error) {
          // Container removal might fail, but that's ok
        }
      }
    }

    // Update task status to cancelled
    task.updateExecutionStatus('cancelled');

    // Clean up Git worktree and branch
    try {
      // Check if we're in a git repository
      launchSync('git', ['rev-parse', '--is-inside-work-tree'], {
        stdio: 'pipe',
      });

      // Remove git workspace if it exists
      if (
        task.worktreePath &&
        (options.removeAll || options.removeGitWorktreeAndBranch)
      ) {
        try {
          launchSync(
            'git',
            ['worktree', 'remove', task.worktreePath, '--force'],
            { stdio: 'pipe' }
          );
          if (spinner) spinner.text = 'Workspace removed';
        } catch (error) {
          // If workspace removal fails, try to remove it manually
          try {
            rmSync(task.worktreePath, { recursive: true, force: true });
            // Remove worktree from git's tracking
            launchSync('git', ['worktree', 'prune'], { stdio: 'pipe' });
          } catch (manualError) {
            if (!json) {
              console.warn(
                colors.yellow('Warning: Could not remove workspace directory')
              );
            }
          }
        }
      }

      // Remove git branch if it exists
      if (
        task.branchName &&
        (options.removeAll || options.removeGitWorktreeAndBranch)
      ) {
        try {
          // Check if branch exists
          launchSync(
            'git',
            [
              'show-ref',
              '--verify',
              '--quiet',
              `refs/heads/${task.branchName}`,
            ],
            { stdio: 'pipe' }
          );
          // Delete the branch
          launchSync('git', ['branch', '-D', task.branchName], {
            stdio: 'pipe',
          });
          if (spinner) spinner.text = 'Branch removed';
        } catch (error) {
          // Branch doesn't exist or couldn't be deleted, which is fine
        }
      }
    } catch (error) {
      // Not in a git repository, skip git operations
    }

    // Delete the iterations
    const taskPath = join(
      findProjectRoot(),
      '.rover',
      'tasks',
      numericTaskId.toString()
    );
    const iterationPath = join(taskPath, 'iterations');
    rmSync(iterationPath, { recursive: true, force: true });

    // Clear workspace information
    task.setWorkspace('', '');

    if (spinner) spinner.success('Task stopped successfully');

    jsonOutput = {
      ...jsonOutput,
      success: true,
      taskId: task.id,
      title: task.title,
      status: task.status,
      stoppedAt: new Date().toISOString(),
    };
    exitWithSuccess('Task stopped successfully!', jsonOutput, json, {
      tips: [
        'Use ' + colors.cyan(`rover logs ${task.id}`) + ' to check the logs',
        'Use ' +
          colors.cyan(`rover restart ${task.id}`) +
          ' to restart the task',
        'Use ' +
          colors.cyan(`rover delete ${task.id}`) +
          ' to delete and clean up the task',
      ],
    });
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = `The task with ID ${numericTaskId} was not found`;
      exitWithError(jsonOutput, json);
      return;
    } else {
      jsonOutput.error = `There was an error stopping the task: ${error}`;
      exitWithError(jsonOutput, json);
      return;
    }
  } finally {
    await telemetry?.shutdown();
  }
};
