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
  showTitle,
  showProperties,
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

    // Check if task is in NEW or FAILED status
    if (!task.isNew() && !task.isFailed()) {
      jsonOutput.error = `Task ${taskId} is not in NEW or FAILED status (current: ${task.status})`;
      await exitWithError(jsonOutput, {
        tips: [
          'Only NEW and FAILED tasks can be restarted',
          'Use ' +
            colors.cyan(`rover inspect ${taskId}`) +
            colors.gray(' to find out the current task status'),
        ],
        telemetry,
      });
      return;
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
      showTitle('Restarting Task');
      const props: Record<string, string> = {
        ID: colors.cyan(task.id.toString()),
        Title: task.title,
        Status: colors.red(task.status),
        Workspace: colors.cyan(worktreePath),
        Branch: colors.cyan(branchName),
      };
      if (process.env.ROVER_AGENT_IMAGE) {
        props['Agent Image'] = colors.cyan(process.env.ROVER_AGENT_IMAGE);
      }
      props['Reset to'] = colors.yellow('NEW');
      showProperties(props);
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
  description: 'Restart a new or failed task',
  requireProject: true,
  action: restartCommand,
} satisfies CommandDefinition;
