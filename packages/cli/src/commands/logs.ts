import colors from 'ansi-colors';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { spawnSync } from '../lib/os.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { getTelemetry } from '../lib/telemetry.js';
import { showTips, TIP_TITLES } from '../utils/display.js';
import { CLIJsonOutput } from '../types.js';
import { exitWithError, exitWithWarn } from '../utils/exit.js';

/**
 * Interface for JSON output
 */
interface TaskLogsOutput extends CLIJsonOutput {
  logs: string;
}

/**
 * Get available iterations for a task
 */
const getAvailableIterations = (taskId: string): number[] => {
  try {
    const roverPath = join(process.cwd(), '.rover');
    const taskPath = join(roverPath, 'tasks', taskId);
    const iterationsPath = join(taskPath, 'iterations');

    if (!existsSync(iterationsPath)) {
      return [];
    }

    return readdirSync(iterationsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => parseInt(dirent.name, 10))
      .filter(num => !isNaN(num))
      .sort((a, b) => a - b); // Sort ascending
  } catch (error) {
    console.error('Error getting available iterations:', error);
    return [];
  }
};

export const logsCommand = async (
  taskId: string,
  iterationNumber?: string,
  options: { follow?: boolean; json?: boolean } = {}
) => {
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
    exitWithError(jsonOutput, json);
    return;
  }

  try {
    // Load task using TaskDescription
    const task = TaskDescription.load(numericTaskId);

    // Parse iteration number if provided
    let targetIteration: number | undefined;
    if (iterationNumber) {
      targetIteration = parseInt(iterationNumber, 10);
      if (isNaN(targetIteration)) {
        jsonOutput.error = `Invalid iteration number: '${iterationNumber}'`;
        exitWithError(jsonOutput, json);
        return;
      }
    }

    // Get available iterations for context
    const availableIterations = getAvailableIterations(
      numericTaskId.toString()
    );

    if (availableIterations.length === 0) {
      exitWithWarn(
        `No iterations found for task '${numericTaskId}'`,
        jsonOutput,
        json
      );
      return;
    }

    // Determine which iteration to show logs for
    const actualIteration =
      targetIteration || availableIterations[availableIterations.length - 1];

    // Check if specific iteration exists (if requested)
    if (targetIteration && !availableIterations.includes(targetIteration)) {
      jsonOutput.error = `Iteration ${targetIteration} not found for task '${numericTaskId}'. Available iterations: ${availableIterations.join(', ')}`;
      exitWithError(jsonOutput, json);
      return;
    }

    // Get container ID (limitation: only works for most recent execution)
    const containerId = task.containerId;

    if (!containerId) {
      exitWithWarn(
        `No container found for task '${numericTaskId}'. Logs are only available for recent tasks`,
        jsonOutput,
        json
      );
      return;
    }

    // Display header
    if (!json) {
      console.log(colors.white.bold(`Task ${numericTaskId} Logs`));
      console.log(colors.gray('├── Title: ') + colors.white(task.title));
      console.log(
        colors.gray('└── Iteration: ') + colors.cyan(`#${actualIteration}`)
      );
    }

    telemetry?.eventLogs();

    if (!json) {
      console.log('');
      console.log(colors.white.bold('Execution Log\n'));
    }

    if (options.follow && !json) {
      // Follow logs in real-time
      console.log(colors.gray('Following logs... (Press Ctrl+C to exit)'));
      console.log('');

      try {
        const logsProcess = spawn('docker', ['logs', '-f', containerId], {
          stdio: ['inherit', 'pipe', 'pipe'],
        });

        // Handle stdout
        logsProcess.stdout?.on('data', data => {
          process.stdout.write(data);
        });

        // Handle stderr
        logsProcess.stderr?.on('data', data => {
          process.stderr.write(data);
        });

        // Handle process completion
        logsProcess.on('close', code => {
          if (code === 0) {
            console.log(colors.green('\n✓ Log following completed'));
          } else {
            console.log(
              colors.yellow(`\n⚠ Log following ended with code ${code}`)
            );
          }
        });

        logsProcess.on('error', error => {
          console.error(colors.red('\nError following logs:'), error.message);
        });

        // Handle process interruption (Ctrl+C)
        process.on('SIGINT', () => {
          console.log(colors.yellow('\n\n⚠ Stopping log following...'));
          logsProcess.kill('SIGTERM');
          process.exit(0);
        });
      } catch (error: any) {
        if (error.message.includes('No such container')) {
          console.log(colors.yellow('⚠ Container no longer exists'));
          console.log(
            colors.gray('Cannot follow logs for a non-existent container')
          );
        } else {
          console.log(colors.red('Error following Docker logs:'));
          console.log(colors.red(error.message));
        }
      }
    } else {
      // Get logs using docker logs command (one-time)
      try {
        const logs = spawnSync('docker', ['logs', containerId], {
          encoding: 'utf8',
          stdio: 'pipe',
        }).stdout.toString();

        if (logs.trim() === '') {
          exitWithWarn(
            'No logs available for this container. Logs are only available for recent tasks',
            jsonOutput,
            json
          );
          return;
        } else {
          if (json) {
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
          exitWithWarn(
            'No logs available for this container. Logs are only available for recent tasks',
            jsonOutput,
            json
          );
          return;
        } else {
          jsonOutput.error = `Error retrieving container logs: ${dockerError.message}`;
          exitWithError(jsonOutput, json);
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
      exitWithError(jsonOutput, json);
    } else {
      jsonOutput.error = `There was an error reading task logs: ${error}`;
      exitWithError(jsonOutput, json);
    }
  } finally {
    await telemetry?.shutdown();
  }
};
