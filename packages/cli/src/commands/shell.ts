import colors from 'ansi-colors';
import { existsSync } from 'node:fs';
import { launch, launchSync } from 'rover-common';
import yoctoSpinner from 'yocto-spinner';
import { statusColor } from '../utils/task-status.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { getTelemetry } from '../lib/telemetry.js';
import { CLIJsonOutput } from '../types.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { generateRandomId } from '../utils/branch-name.js';

/**
 * Start an interactive shell for testing task changes
 */
export const shellCommand = async (
  taskId: string,
  options: { container?: boolean }
) => {
  const telemetry = getTelemetry();

  // Add the JSON flag to use some utilities. However, this command is interactive
  // so it is always false.
  const json = false;
  // Fake JSON output
  const jsonOutput: CLIJsonOutput = { success: false };

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

    const colorFunc = statusColor(task.status);

    console.log(colors.bold('Task details'));
    console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
    console.log(colors.gray('├── Title: ') + task.title);
    console.log(colors.gray('└── Status: ') + colorFunc(task.status) + '\n');

    // Check if worktree exists
    if (!task.worktreePath || !existsSync(task.worktreePath)) {
      jsonOutput.error = `No worktree found for this task`;
      exitWithError(jsonOutput, json);
      return;
    }

    telemetry?.eventShell();

    if (options.container) {
      // Check if Docker is available
      try {
        launchSync('docker', ['--version']);
      } catch (error) {
        jsonOutput.error = `Docker is not available. Please install it.`;
        exitWithError(jsonOutput, json);
        return;
      }
    }

    console.log(
      colors.green('✓ Starting interactive shell in the task workspace')
    );
    console.log(
      colors.gray('Type') +
        colors.cyan(' "exit" ') +
        colors.gray('to leave the shell')
    );
    console.log('');

    const spinner = yoctoSpinner({ text: 'Starting shell...' }).start();

    let shellProcess;

    if (options.container) {
      try {
        const containerName = `rover-shell-${numericTaskId}-${generateRandomId()}`;

        // Build Docker run command for interactive shell
        const dockerArgs = [
          'run',
          '--rm', // Remove container when it exits
          '-it', // Interactive with TTY
          '--name',
          containerName,
          '-v',
          `${task.worktreePath}:/workspace:rw`,
          '-w',
          '/workspace',
          'node:24-alpine',
          '/bin/sh',
        ];

        // Start Docker container with direct stdio inheritance for true interactivity
        const containerProcess = launch('docker', dockerArgs, {
          stdio: 'inherit', // This gives full control to the user
        });

        spinner.success(`Shell started. Container name: ${containerName}`);

        // Wait for the user to exit the container
        shellProcess = await containerProcess;
      } catch (error) {
        jsonOutput.error = 'Failed to start container: ' + error;
        exitWithError(jsonOutput, json);
        return;
      }
    } else {
      const shell = process.env.SHELL || '/bin/sh';

      try {
        const shellInit = launch(shell, [], {
          stdio: 'inherit',
          cwd: task.worktreePath,
        });

        spinner.success(`Shell started using ${shell}`);

        // Await for the process to complete
        shellProcess = await shellInit;
      } catch (error) {
        spinner.error(`Failed to start shell ${shell}`);
        jsonOutput.error = 'Failed to start shell: ' + error;
        exitWithError(jsonOutput, json);
        return;
      }
    }

    if (shellProcess) {
      // Handle process completion
      if (shellProcess.exitCode === 0) {
        exitWithSuccess('Shell session ended', jsonOutput, json);
      } else {
        exitWithWarn(
          `Shell session ended with code ${shellProcess.exitCode}`,
          jsonOutput,
          json
        );
      }
    }
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = `The task with ID ${numericTaskId} was not found`;
      exitWithError(jsonOutput, json);
    } else {
      jsonOutput.error = `There was an error starting the shell: ${error}`;
      exitWithError(jsonOutput, json);
    }
  } finally {
    await telemetry?.shutdown();
  }
};
