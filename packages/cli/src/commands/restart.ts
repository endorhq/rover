import colors from 'ansi-colors';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';
import { CLIJsonOutput } from '../types.js';
import { startCommand } from './start.js';
import { getTelemetry } from '../lib/telemetry.js';

/**
 * Interface for JSON output
 */
interface TaskRestartOutput extends CLIJsonOutput {
  taskId?: number;
  title?: string;
  description?: string;
  status?: string;
  restartedAt?: string;
}

/**
 * Restart a task that is in FAILED status
 */
export const restartCommand = async (
  taskId: string,
  options: { follow?: boolean; json?: boolean; debug?: boolean } = {}
) => {
  const telemetry = getTelemetry();

  const json = options.json === true;
  let jsonOutput: TaskRestartOutput = {
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

    // Check if task is in FAILED status
    if (!task.isFailed()) {
      jsonOutput.error = `Task ${taskId} is not in FAILED status (current: ${task.status})`;
      exitWithError(jsonOutput, json, {
        tips: [
          'Only FAILED tasks can be restarted',
          'Use ' +
            colors.cyan(`rover start ${taskId}`) +
            colors.gray(' for NEW tasks'),
        ],
      });
      return;
    }

    if (!json) {
      console.log(colors.bold.white('Restarting Task'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + colors.white(task.title));
      console.log(colors.gray('└── Status: ') + colors.red(task.status));
    }

    // Restart the task (resets to NEW status and tracks restart attempt)
    const restartedAt = new Date().toISOString();
    task.restart(restartedAt);

    if (!json) {
      console.log(colors.gray('└── Reset to: ') + colors.yellow('NEW'));
      console.log(colors.green('✓ Task reset successfully'));
      console.log('');
    }

    // Start the task using the existing start command
    await startCommand(taskId, options);

    // Output final JSON after all operations are complete
    jsonOutput = {
      ...jsonOutput,
      success: true,
      taskId: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      restartedAt: restartedAt,
    };

    if (!json) {
      console.log(colors.green('✓ Task restarted successfully!'));
    }

    return;
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = `The task with ID ${numericTaskId} was not found`;
      exitWithError(jsonOutput, json);
      return;
    } else {
      jsonOutput.error = `There was an error restarting the task: ${error}`;
      exitWithError(jsonOutput, json);
      return;
    }
  } finally {
    await telemetry?.shutdown();
  }
};
