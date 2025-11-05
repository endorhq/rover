import colors from 'ansi-colors';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { generateBranchName } from '../utils/branch-name.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';
import { createSandbox } from '../lib/sandbox/index.js';
import { UserSettings, AI_AGENT } from '../lib/config.js';
import { Git } from 'rover-common';
import { CLIJsonOutput } from '../types.js';
import { IterationManager } from 'rover-schemas';
import { getTelemetry } from '../lib/telemetry.js';
import yoctoSpinner from 'yocto-spinner';
import { copyEnvironmentFiles } from '../utils/env-files.js';
import { findProjectRoot } from 'rover-common';

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
 * Restart a task that is in NEW or FAILED status
 */
export const restartCommand = async (
  taskId: string,
  options: { json?: boolean } = {}
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

    // Check if task is in NEW or FAILED status
    if (!task.isNew() && !task.isFailed()) {
      jsonOutput.error = `Task ${taskId} is not in NEW or FAILED status (current: ${task.status})`;
      exitWithError(jsonOutput, json, {
        tips: [
          'Only NEW and FAILED tasks can be restarted',
          'Use ' +
            colors.cyan(`rover inspect ${taskId}`) +
            colors.gray(' to find out the current task status'),
        ],
      });
      return;
    }

    // Restart the task (resets to NEW status and tracks restart attempt)
    const restartedAt = new Date().toISOString();
    task.restart(restartedAt);

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

    const taskPath = join(
      findProjectRoot(),
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
        copyEnvironmentFiles(findProjectRoot(), worktreePath);

        // Update task with workspace information
        task.setWorkspace(worktreePath, branchName);

        if (spinner) spinner.success('Workspace setup complete');
      } catch (error) {}
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
      IterationManager.createInitial(
        iterationPath,
        task.id,
        task.title,
        task.description
      );
    }

    if (!json) {
      console.log(colors.bold('Restarting Task'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + task.title);
      console.log(colors.gray('├── Status: ') + colors.red(task.status));
      console.log(colors.gray('├── Workspace: ') + colors.cyan(worktreePath));
      console.log(colors.gray('├── Branch: ') + colors.cyan(branchName));
      console.log(colors.gray('└── Reset to: ') + colors.yellow('NEW'));
      console.log(colors.green('\n✓ Task reset successfully'));
      console.log('');
    }

    // Mark task as in progress
    task.markInProgress();

    // Start sandbox container for task execution
    try {
      const sandbox = await createSandbox(task);
      await sandbox.createAndStart();
    } catch (error) {
      // If sandbox execution fails, reset task back to NEW status
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
      restartedAt: restartedAt,
    };

    exitWithSuccess('Task restarted succesfully!', jsonOutput, json, {
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
      jsonOutput.error = `There was an error restarting the task: ${error}`;
      exitWithError(jsonOutput, json);
      return;
    }
  } finally {
    await telemetry?.shutdown();
  }
};
