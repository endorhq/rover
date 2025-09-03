import colors from 'ansi-colors';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { spawnSync } from '../lib/os.js';
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
  options: { json?: boolean } = {}
) => {
  const telemetry = getTelemetry();

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
      console.log(colors.bold.white('Stopping Task'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + colors.white(task.title));
      console.log(colors.gray('└── Status: ') + colors.yellow(task.status));
    }

    const spinner = !json
      ? yoctoSpinner({ text: 'Stopping task...' }).start()
      : null;

    // Stop Docker container if it exists and is running
    if (task.containerId) {
      try {
        spawnSync('docker', ['stop', task.containerId]);
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
      try {
        spawnSync('docker', ['rm', '-f', task.containerId]);
        if (spinner) spinner.text = 'Container removed';
      } catch (error) {
        // Container removal might fail, but that's ok
      }
    }

    // Update task status to cancelled
    task.updateExecutionStatus('cancelled');

    // Clean up Git worktree and branch
    try {
      // Check if we're in a git repository
      spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
        stdio: 'pipe',
      });

      // Remove git workspace if it exists
      if (task.worktreePath) {
        try {
          spawnSync(
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
            spawnSync('git', ['worktree', 'prune'], { stdio: 'pipe' });
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
      if (task.branchName) {
        try {
          // Check if branch exists
          spawnSync(
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
          spawnSync('git', ['branch', '-D', task.branchName], {
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
      process.cwd(),
      '.rover',
      'tasks',
      numericTaskId.toString()
    );
    const iterationPath = join(taskPath, 'iterations');
    rmSync(iterationPath, { recursive: true, force: true });

    // Clear workspace information
    task.setWorkspace('', '');

    if (spinner) spinner.success('Task stopped successfully');

    if (!json) {
      console.log(colors.green('\n✓ Task has been stopped and cleaned up'));
      console.log(colors.gray('  Status: ') + colors.cyan('cancelled'));
      console.log(colors.gray('  Container stopped and removed'));
      console.log(colors.gray('  Workspace and branch removed'));
      console.log(colors.gray('  Iterations cleaned up'));
    }

    // Output final JSON after all operations are complete
    jsonOutput = {
      ...jsonOutput,
      success: true,
      taskId: task.id,
      title: task.title,
      status: task.status,
      stoppedAt: new Date().toISOString(),
    };
    exitWithSuccess('Task stopped successfully!', jsonOutput, json);
    return;
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
