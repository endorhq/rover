import colors from 'ansi-colors';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { generateBranchName } from '../utils/branch-name.js';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';
import { CLIJsonOutput } from '../types.js';
import { IterationConfig } from '../lib/iteration.js';
import { startDockerExecution } from './task.js';
import { UserSettings, AI_AGENT } from '../lib/config.js';
import { getTelemetry } from '../lib/telemetry.js';
import { Git } from '../lib/git.js';
import yoctoSpinner from 'yocto-spinner';
import { copyEnvironmentFiles } from '../utils/env-files.js';

/**
 * Interface for JSON output
 */
interface TaskStartOutput extends CLIJsonOutput {
  taskId?: number;
  title?: string;
  description?: string;
  status?: string;
  startedAt?: string;
  workspace?: string;
  branch?: string;
}

/**
 * Start a task that is in NEW status
 */
export const startCommand = async (
  taskId: string,
  options: { json?: boolean; debug?: boolean } = {}
) => {
  const telemetry = getTelemetry();

  const json = options.json === true;
  let jsonOutput: TaskStartOutput = {
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

    // Check if task is in NEW status
    if (!task.isNew()) {
      jsonOutput.error = `Task ${taskId} is not in NEW status (current: ${task.status})`;
      exitWithError(jsonOutput, json, {
        tips: [
          'Use ' +
            colors.cyan(`rover task "${task.title}"`) +
            colors.gray(' to create a new task'),
        ],
      });
      return;
    }

    // Load AI agent selection from user settings
    let selectedAiAgent = AI_AGENT.Claude; // default

    try {
      if (UserSettings.exists()) {
        const userSettings = UserSettings.load();
        selectedAiAgent = userSettings.defaultAiAgent || AI_AGENT.Claude;
      }
    } catch (error) {
      if (!json) {
        console.log(
          colors.yellow('⚠ Could not load user settings, defaulting to Claude')
        );
      }
      selectedAiAgent = AI_AGENT.Claude;
    }

    if (!json) {
      console.log(colors.bold.white('Starting Task'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + colors.white(task.title));
      console.log(colors.gray('└── Status: ') + colors.yellow(task.status));
    }

    const taskPath = join(
      process.cwd(),
      '.rover',
      'tasks',
      numericTaskId.toString()
    );

    // Setup git worktree and branch if not already set
    let worktreePath = task.worktreePath;
    let branchName = task.branchName;

    if (!worktreePath || !branchName) {
      worktreePath = join(taskPath, 'workspace');
      branchName = generateBranchName(numericTaskId);

      const spinner = !json
        ? yoctoSpinner({ text: 'Setting up workspace...' }).start()
        : null;

      try {
        const git = new Git();
        git.createWorktree(worktreePath, branchName);

        // Copy user .env development files
        copyEnvironmentFiles(process.cwd(), worktreePath);

        // Update task with workspace information
        task.setWorkspace(worktreePath, branchName);

        if (spinner) spinner.success('Workspace setup complete');
      } catch (error) {
        if (spinner) spinner.error('Failed to setup workspace');
        if (!json) {
          console.error(colors.red('Error creating git workspace:'), error);
        }
        // Mark task back to NEW status due to setup failure
        task.resetToNew();
        return;
      }
    }

    // Ensure iterations directory exists
    const iterationPath = join(
      taskPath,
      'iterations',
      task.iterations.toString()
    );
    mkdirSync(iterationPath, { recursive: true });

    // Create initial iteration.json if it doesn't exist
    const iterationJsonPath = join(iterationPath, 'iteration.json');
    if (!existsSync(iterationJsonPath)) {
      IterationConfig.createInitial(
        iterationPath,
        task.id,
        task.title,
        task.description
      );
    }

    // Mark task as in progress
    task.markInProgress();

    if (!json) {
      console.log(colors.gray('└── Workspace: ') + colors.cyan(worktreePath));
      console.log(colors.gray('└── Branch: ') + colors.cyan(branchName));
    }

    // Start Docker container for task execution
    try {
      await startDockerExecution(
        numericTaskId,
        task,
        worktreePath,
        iterationPath,
        selectedAiAgent,
        json,
        options.debug
      );
    } catch (error) {
      // If Docker execution fails, reset task back to NEW status
      task.resetToNew();
      throw error;
    }

    // Output final JSON after all operations are complete
    jsonOutput = {
      ...jsonOutput,
      success: true,
      taskId: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      startedAt: task.startedAt,
      workspace: task.worktreePath,
      branch: task.branchName,
    };
    exitWithSuccess('Task started succesfully!', jsonOutput, json, {
      tips: [
        'Use ' + colors.cyan('rover list') + ' to check the list of tasks',
        'Use ' +
          colors.cyan(`rover logs -f ${task.id}`) +
          ' to watch the task logs',
        'Use ' +
          colors.cyan(`rover inspect ${task.id}`) +
          ' to check the task status',
      ],
    });
    return;
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = `The task with ID ${numericTaskId} was not found`;
      exitWithError(jsonOutput, json);
      return;
    } else {
      jsonOutput.error = `There was an error starting the task: ${error}`;
      exitWithError(jsonOutput, json);
      return;
    }
  } finally {
    await telemetry?.shutdown();
  }
};
