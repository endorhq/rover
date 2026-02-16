import colors from 'ansi-colors';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { generateBranchName } from '../utils/branch-name.js';
import {
  UserSettingsManager,
  IterationManager,
  AI_AGENT,
  Git,
  ProjectConfigManager,
  type ProjectManager,
} from 'rover-core';
import { TaskNotFoundError } from 'rover-schemas';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';
import { createSandbox } from '../lib/sandbox/index.js';
import type { TaskRestartOutput } from '../output-types.js';
import { getTelemetry } from '../lib/telemetry.js';
import {
  isJsonMode,
  setJsonMode,
  requireProjectContext,
} from '../lib/context.js';
import yoctoSpinner from 'yocto-spinner';
import { copyEnvironmentFiles } from '../utils/env-files.js';
import type { CommandDefinition } from '../types.js';

/**
 * Restart a task that is in NEW or FAILED status.
 *
 * Re-executes a task that either never started (NEW) or previously failed.
 * Resets the task state, ensures the git worktree exists, and spawns a new
 * sandboxed container to run the AI agent. Useful for retrying tasks after
 * fixing configuration issues or transient failures.
 *
 * @param taskId - The numeric task ID to restart
 * @param options - Command options
 * @param options.json - Output results in JSON format
 */
const restartCommand = async (
  taskId: string,
  options: { json?: boolean } = {}
) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const telemetry = getTelemetry();

  const json = options.json === true;
  let jsonOutput: TaskRestartOutput = {
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

    // Check if task is in a restartable status
    if (!task.isNew() && !task.isFailed()) {
      if (task.isInProgress()) {
        // Allow restarting IN_PROGRESS tasks if the container is dead
        try {
          const sandbox = await createSandbox(task, undefined, {
            projectPath: project.path,
          });
          const state = await sandbox.inspect();
          // Container is still running — reject the restart
          if (state && state.status === 'running') {
            jsonOutput.error = `Task ${taskId} is IN_PROGRESS and its container is still running`;
            await exitWithError(jsonOutput, {
              tips: [
                'The container for this task is still running',
                'Use ' +
                  colors.cyan(`rover logs -f ${taskId}`) +
                  colors.gray(' to watch the task logs'),
              ],
              telemetry,
            });
            return;
          }
          // Container is dead (exited or not found) — allow restart to proceed
        } catch {
          // If we can't inspect (e.g. no backend available), allow restart
        }
      } else {
        jsonOutput.error = `Task ${taskId} is not in NEW or FAILED status (current: ${task.status})`;
        await exitWithError(jsonOutput, {
          tips: [
            'Only NEW, FAILED, and stuck IN_PROGRESS tasks can be restarted',
            'Use ' +
              colors.cyan(`rover inspect ${taskId}`) +
              colors.gray(' to find out the current task status'),
          ],
          telemetry,
        });
        return;
      }
    }

    // Restart the task (resets to NEW status and tracks restart attempt)
    const restartedAt = new Date().toISOString();
    task.restart(restartedAt);

    // Load AI agent selection from user settings
    let selectedAiAgent = AI_AGENT.Claude; // default

    try {
      if (UserSettingsManager.exists(project.path)) {
        const userSettings = UserSettingsManager.load(project.path);
        selectedAiAgent = userSettings.defaultAiAgent || AI_AGENT.Claude;
      }
    } catch (error) {
      if (!isJsonMode()) {
        console.log(
          colors.yellow('⚠ Could not load user settings, defaulting to Claude')
        );
      }
      selectedAiAgent = AI_AGENT.Claude;
    }

    // Setup git worktree and branch if not already set
    let worktreePath = task.worktreePath;
    let branchName = task.branchName;

    if (!worktreePath || !branchName) {
      worktreePath = project.getWorkspacePath(numericTaskId);
      branchName = generateBranchName(numericTaskId);

      const spinner = !json
        ? yoctoSpinner({ text: 'Setting up workspace...' }).start()
        : null;

      try {
        const git = new Git({ cwd: project.path });
        git.createWorktree(worktreePath, branchName);

        // Copy user .env development files
        copyEnvironmentFiles(project.path, worktreePath);

        // Configure sparse checkout to exclude files matching exclude patterns
        const projectConfig = ProjectConfigManager.load(project.path);
        if (
          projectConfig.excludePatterns &&
          projectConfig.excludePatterns.length > 0
        ) {
          git.setupSparseCheckout(worktreePath, projectConfig.excludePatterns);
        }

        // Update task with workspace information
        task.setWorkspace(worktreePath, branchName);

        if (spinner) spinner.success('Workspace setup complete');
      } catch (error) {}
    }

    // Ensure iterations directory exists
    const iterationPath = join(
      task.iterationsPath(),
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

    if (!isJsonMode()) {
      console.log(colors.bold('Restarting Task'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + task.title);
      console.log(colors.gray('├── Status: ') + colors.red(task.status));
      console.log(colors.gray('├── Workspace: ') + colors.cyan(worktreePath));
      console.log(colors.gray('├── Branch: ') + colors.cyan(branchName));
      if (process.env.ROVER_AGENT_IMAGE) {
        console.log(
          colors.gray('├── Agent Image: ') +
            colors.cyan(process.env.ROVER_AGENT_IMAGE)
        );
        console.log(colors.gray('└── Reset to: ') + colors.yellow('NEW'));
      } else {
        console.log(colors.gray('└── Reset to: ') + colors.yellow('NEW'));
      }
      console.log(colors.green('\n✓ Task reset successfully'));
      console.log('');
    }

    // Mark task as in progress
    task.markInProgress();

    // Track restart event
    telemetry?.eventRestartTask();

    // Override agent image from environment variable if set
    if (process.env.ROVER_AGENT_IMAGE) {
      task.setAgentImage(process.env.ROVER_AGENT_IMAGE);
    }

    // Start sandbox container for task execution
    try {
      const sandbox = await createSandbox(task, undefined, {
        projectPath: project.path,
        iterationLogsPath: project.getTaskIterationLogsPath(
          task.id,
          task.iterations
        ),
      });
      const containerId = await sandbox.createAndStart();

      // Update task metadata with new container ID
      task.setContainerInfo(
        containerId,
        'running',
        process.env.DOCKER_HOST
          ? { dockerHost: process.env.DOCKER_HOST }
          : undefined
      );
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

    await exitWithSuccess('Task restarted succesfully!', jsonOutput, {
      tips: [
        'Use ' + colors.cyan('rover list') + ' to check the list of tasks',
        'Use ' +
          colors.cyan(`rover logs -f ${task.id}`) +
          ' to watch the task logs',
        'Use ' +
          colors.cyan(`rover inspect ${task.id}`) +
          ' to check the task status',
      ],
      telemetry,
    });

    return;
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = `The task with ID ${numericTaskId} was not found`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    } else {
      jsonOutput.error = `There was an error restarting the task: ${error}`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }
  } finally {
    await telemetry?.shutdown();
  }
};

// Named export for backwards compatibility (used by tests)
export { restartCommand };

export default {
  name: 'restart',
  description: 'Restart a new, failed, or stuck in-progress task',
  requireProject: true,
  action: restartCommand,
} satisfies CommandDefinition;
