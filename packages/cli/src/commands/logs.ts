import colors from 'ansi-colors';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, launchSync, type TaskDescriptionManager } from 'rover-core';
import { TaskNotFoundError } from 'rover-schemas';
import { getTelemetry } from '../lib/telemetry.js';
import { showTips } from '../utils/display.js';
import type { TaskLogsOutput } from '../output-types.js';
import { exitWithError, exitWithWarn } from '../utils/exit.js';
import {
  isJsonMode,
  setJsonMode,
  requireProjectContext,
} from '../lib/context.js';
import type { CommandDefinition } from '../types.js';

/**
 * Get available iterations for a task
 */
const getAvailableIterations = (task: TaskDescriptionManager): number[] => {
  try {
    const iterationsPath = task.iterationsPath();

    if (!existsSync(iterationsPath)) {
      return [];
    }

    return readdirSync(iterationsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => parseInt(dirent.name, 10))
      .filter(num => !Number.isNaN(num))
      .sort((a, b) => a - b); // Sort ascending
  } catch (error) {
    console.error('Error getting available iterations:', error);
    return [];
  }
};

/**
 * Display execution logs for a Rover task iteration.
 *
 * Retrieves and displays the Docker container logs for a task's execution.
 * Shows the AI agent's real-time activity including commands run, files modified,
 * and progress updates. Supports following logs in real-time for running tasks.
 *
 * @param taskId - The numeric task ID to show logs for
 * @param iterationNumber - Optional specific iteration number (defaults to latest)
 * @param options - Command options
 * @param options.follow - Follow log output in real-time (like tail -f)
 * @param options.json - Output logs in JSON format
 */
const logsCommand = async (
  taskId: string,
  iterationNumber?: string,
  options: { follow?: boolean; json?: boolean } = {}
) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  // Init telemetry
  const telemetry = getTelemetry();

  // Json config
  const json = options.json === true;
  const jsonOutput: TaskLogsOutput = {
    logs: '',
    success: false,
  };

  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    jsonOutput.error = `Invalid task ID '${taskId}' - must be a number`;
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

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
    // Load task using ProjectManager
    const task = project.getTask(numericTaskId);
    if (!task) {
      throw new TaskNotFoundError(numericTaskId);
    }

    // Parse iteration number if provided
    let targetIteration: number | undefined;
    if (iterationNumber) {
      targetIteration = parseInt(iterationNumber, 10);
      if (Number.isNaN(targetIteration)) {
        jsonOutput.error = `Invalid iteration number: '${iterationNumber}'`;
        await exitWithError(jsonOutput, { telemetry });
        return;
      }
    }

    // Get available iterations for context
    const availableIterations = getAvailableIterations(task);

    if (availableIterations.length === 0) {
      await exitWithWarn(
        `No iterations found for task '${numericTaskId}'`,
        jsonOutput,
        { telemetry }
      );
      return;
    }

    // Determine which iteration to show logs for
    const actualIteration =
      targetIteration || availableIterations[availableIterations.length - 1];

    // Check if specific iteration exists (if requested)
    if (targetIteration && !availableIterations.includes(targetIteration)) {
      jsonOutput.error = `Iteration ${targetIteration} not found for task '${numericTaskId}'. Available iterations: ${availableIterations.join(', ')}`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }

    // Get container ID (limitation: only works for most recent execution)
    const containerId = task.containerId;

    if (!containerId) {
      await exitWithWarn(
        `No container found for task '${numericTaskId}'. Logs are only available for recent tasks`,
        jsonOutput,
        { telemetry }
      );
      return;
    }

    // Display header
    if (!isJsonMode()) {
      console.log(colors.bold(`Task ${numericTaskId} Logs`));
      console.log(colors.gray('├── Title: ') + task.title);
      console.log(
        colors.gray('└── Iteration: ') + colors.cyan(`#${actualIteration}`)
      );
    }

    telemetry?.eventLogs();

    if (!isJsonMode()) {
      console.log('');
      console.log(colors.bold('Execution Log\n'));
    }

    if (options.follow && !json) {
      // Follow logs in real-time
      console.log(colors.gray('Following logs... (Press Ctrl+C to exit)'));
      console.log('');

      const controller = new AbortController();
      const cancelSignal = controller.signal;

      // Register SIGINT handler before launching so Ctrl+C
      // aborts the detached docker process
      const sigintHandler = () => {
        controller.abort();
      };
      process.on('SIGINT', sigintHandler);

      try {
        // Build environment with stored DOCKER_HOST if available
        const dockerHost = task.sandboxMetadata?.dockerHost;
        const dockerEnv =
          typeof dockerHost === 'string'
            ? { ...process.env, DOCKER_HOST: dockerHost }
            : process.env;

        const logsProcess = await launch(
          'docker',
          ['logs', '-f', containerId],
          {
            stdout: ['inherit'],
            stderr: ['inherit'],
            cancelSignal,
            env: dockerEnv,
          }
        );

        // Done
        if (logsProcess.exitCode === 0) {
          console.log(colors.green('\n✓ Log following completed'));
        } else {
          console.log(
            colors.yellow(
              `\n⚠ Log following ended with code ${logsProcess.exitCode}`
            )
          );
        }
      } catch (error: any) {
        if (error.isCanceled) {
          // Clean exit on Ctrl+C
          console.log(colors.yellow('\n\n⚠ Stopping log following...'));
        } else if (error.message?.includes('No such container')) {
          console.log(colors.yellow('⚠ Container no longer exists'));
          console.log(
            colors.gray('Cannot follow logs for a non-existent container')
          );
        } else {
          console.log(colors.red('Error following Docker logs:'));
          console.log(colors.red(error.message));
        }
      } finally {
        process.removeListener('SIGINT', sigintHandler);
      }
    } else {
      // Get logs using docker logs command (one-time)
      try {
        // Build environment with stored DOCKER_HOST if available
        const dockerHostSync = task.sandboxMetadata?.dockerHost;
        const dockerEnvSync =
          typeof dockerHostSync === 'string'
            ? { ...process.env, DOCKER_HOST: dockerHostSync }
            : process.env;

        const logs =
          launchSync('docker', ['logs', containerId], {
            env: dockerEnvSync,
          })?.stdout?.toString() || '';

        if (logs.trim() === '') {
          await exitWithWarn(
            'No logs available for this container. Logs are only available for recent tasks',
            jsonOutput,
            { telemetry }
          );
          return;
        } else {
          if (isJsonMode()) {
            // Store logs
            jsonOutput.logs = logs;
          } else {
            const logLines = logs.split('\n');
            // Display logs with basic formatting
            for (const line of logLines) {
              if (line.trim() === '') {
                console.log('');
                continue;
              }

              console.log(line);
            }
          }
        }
      } catch (dockerError: any) {
        if (dockerError.message.includes('No such container')) {
          await exitWithWarn(
            'No logs available for this container. Logs are only available for recent tasks',
            jsonOutput,
            { telemetry }
          );
          return;
        } else {
          jsonOutput.error = `Error retrieving container logs: ${dockerError.message}`;
          await exitWithError(jsonOutput, { telemetry });
          return;
        }
      }
    }

    // Only show tips if not in follow mode nor json (since follow mode blocks)
    if (!options.follow && !json) {
      const tips = [];

      // Show tips
      if (availableIterations.length > 1) {
        const otherIterations = availableIterations.filter(
          i => i !== actualIteration
        );
        if (otherIterations.length > 0) {
          console.log(colors.gray('💡 Tips:'));
          tips.push(
            'Use ' +
              colors.cyan(`rover logs ${numericTaskId} <iteration>`) +
              ' to view specific iteration (if container exists)'
          );
        }
      }

      tips.push(
        'Use ' +
          colors.cyan(`rover logs ${numericTaskId} --follow`) +
          ' to follow logs in real-time'
      );
      tips.push(
        'Use ' +
          colors.cyan(`rover diff ${numericTaskId}`) +
          ' to see code changes'
      );

      showTips(tips);
    }
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = `The task with ID ${numericTaskId} was not found`;
      await exitWithError(jsonOutput, { telemetry });
    } else {
      jsonOutput.error = `There was an error reading task logs: ${error}`;
      await exitWithError(jsonOutput, { telemetry });
    }
  } finally {
    await telemetry?.shutdown();
  }
};

// Named export for backwards compatibility (used by tests)
export { logsCommand };

export default {
  name: 'logs',
  description: 'Show execution logs for a task iteration',
  requireProject: true,
  action: logsCommand,
} satisfies CommandDefinition;
