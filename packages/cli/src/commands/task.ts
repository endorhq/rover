import enquirer from 'enquirer';
import colors from 'ansi-colors';
import yoctoSpinner from 'yocto-spinner';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getNextTaskId } from '../utils/task-id.js';
import { homedir, userInfo } from 'node:os';
import { getAIAgentTool, getUserAIAgent } from '../lib/agents/index.js';
import type { IPromptTask } from '../lib/prompts/index.js';
import { TaskDescription } from '../lib/description.js';
import { PromptBuilder } from '../lib/prompts/index.js';
import { SetupBuilder } from '../lib/setup.js';
import { AI_AGENT } from '../lib/config.js';
import { IterationConfig } from '../lib/iteration.js';
import { generateBranchName } from '../utils/branch-name.js';
import { request } from 'node:https';
import { findProjectRoot, launch, launchSync } from 'rover-common';
import { checkGitHubCLI } from '../utils/system.js';
import { showRoverBanner, showRoverChat, showTips } from '../utils/display.js';
import { getTelemetry } from '../lib/telemetry.js';
import { NewTaskProvider } from 'rover-telemetry';
import { Git } from 'rover-common';
import { readFromStdin, stdinIsAvailable } from '../utils/stdin.js';
import { CLIJsonOutput } from '../types.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { GitHub, GitHubError } from '../lib/github.js';
import { copyEnvironmentFiles } from '../utils/env-files.js';

const { prompt } = enquirer;

type validationResult = {
  error: string;
  tips?: string[];
} | null;

/**
 * Command validations.
 */
const validations = (
  selectedAiAgent?: string,
  isJsonMode?: boolean
): validationResult => {
  // Check AI agent credentials based on selected agent
  if (selectedAiAgent === 'claude') {
    const claudeFile = join(homedir(), '.claude.json');

    if (!existsSync(claudeFile)) {
      return {
        error: 'Claude configuration not found',
        tips: ['Run ' + colors.cyan('claude') + ' first to configure it'],
      };
    }
  } else if (selectedAiAgent === 'gemini') {
    // Check Gemini credentials if needed
    const geminiFile = join(homedir(), '.gemini', 'settings.json');
    const geminiCreds = join(homedir(), '.gemini', 'oauth_creds.json');

    if (!existsSync(geminiFile)) {
      return {
        error: 'Gemini configuration not found',
        tips: ['Run ' + colors.cyan('gemini') + ' first to configure it'],
      };
    }

    if (!existsSync(geminiCreds)) {
      return {
        error: 'Gemini credentials not found',
        tips: ['Run ' + colors.cyan('gemini') + ' first to set up credentials'],
      };
    }
  } else if (selectedAiAgent === 'qwen') {
    // Check Gemini credentials if needed
    const qwenFile = join(homedir(), '.qwen', 'settings.json');
    const qwenCreds = join(homedir(), '.qwen', 'oauth_creds.json');

    if (!existsSync(qwenFile)) {
      return {
        error: 'Qwen configuration not found',
        tips: ['Run ' + colors.cyan('qwen') + ' first to configure it'],
      };
    }

    if (!existsSync(qwenCreds)) {
      return {
        error: 'Qwen credentials not found',
        tips: ['Run ' + colors.cyan('qwen') + ' first to set up credentials'],
      };
    }
  }

  return null;
};

/**
 * Update task metadata with execution information
 */
const updateTaskMetadata = (
  taskId: number,
  updates: any,
  jsonMode?: boolean
) => {
  try {
    if (TaskDescription.exists(taskId)) {
      const task = TaskDescription.load(taskId);

      // Apply updates to the task object based on the updates parameter
      if (updates.status) {
        task.setStatus(updates.status);
      }
      if (updates.title) {
        task.updateTitle(updates.title);
      }
      if (updates.description) {
        task.updateDescription(updates.description);
      }
      if (updates.worktreePath && updates.branchName) {
        task.setWorkspace(updates.worktreePath, updates.branchName);
      }

      // Handle Docker execution metadata
      if (updates.containerId && updates.executionStatus) {
        task.setContainerInfo(updates.containerId, updates.executionStatus);
      } else if (updates.executionStatus) {
        task.updateExecutionStatus(updates.executionStatus, {
          exitCode: updates.exitCode,
          error: updates.error,
        });
      }
    }
  } catch (error) {
    // Silently fail in JSON mode, otherwise log the error
    if (!jsonMode) {
      console.error(colors.red('Error updating task metadata:'), error);
    }
  }
};

/**
 * Start environment using containers
 */
export const startDockerExecution = async (
  taskId: number,
  task: TaskDescription,
  worktreePath: string,
  iterationPath: string,
  selectedAiAgent: string,
  jsonMode?: boolean,
  debug?: boolean
) => {
  const containerName = `rover-task-${taskId}-${task.iterations}`;

  try {
    // Check if Docker is available
    launchSync('docker', ['--version']);
  } catch (error) {
    if (!jsonMode) {
      console.log(colors.red('\n✗ Docker is not available'));
      console.log(
        colors.gray('  Please install Docker to use automated task execution')
      );
    }
    return;
  }

  // Load task description
  const iterationJsonPath = join(iterationPath, 'iteration.json');
  const iteration = IterationConfig.load(iterationPath);

  // Generate setup script using SetupBuilder
  const setupBuilder = new SetupBuilder(task, selectedAiAgent);
  const setupScriptPath = setupBuilder.generateSetupScript();
  const setupMcpScriptPath = setupBuilder.generateSetupMcpScript();

  // Generate prompts using PromptBuilder
  const promptsDir = join(
    findProjectRoot(),
    '.rover',
    'tasks',
    taskId.toString(),
    'iterations',
    task.iterations.toString(),
    'prompts'
  );
  const promptBuilder = new PromptBuilder(selectedAiAgent);
  promptBuilder.generatePromptFiles(iteration, promptsDir);

  // Get agent-specific Docker mounts
  const agent = getAIAgentTool(selectedAiAgent);
  const dockerMounts: string[] = agent.getContainerMounts();

  if (!jsonMode) {
    console.log(colors.white.bold('\n🐳 Starting Docker container:'));
    console.log(
      colors.gray('└── Container Name: ') + colors.white(containerName)
    );
  }

  // Clean up any existing container with same name
  try {
    launchSync('docker', ['rm', '-f', containerName]);
  } catch (error) {
    // Container doesn't exist, which is fine
  }

  if (!jsonMode) {
    console.log('');
  }

  const spinner = !jsonMode
    ? yoctoSpinner({ text: 'Starting container...' }).start()
    : null;

  try {
    // Build Docker run command with mounts
    const dockerArgs = [
      'run',
      '--name',
      containerName,
      // For now, do not remove for logs
      // '--rm'
      '-d',
    ];

    const currentUser = userInfo();

    dockerArgs.push(
      '-v',
      `${worktreePath}:/workspace:Z,rw`,
      '-v',
      `${iterationPath}:/output:Z,rw`,
      ...dockerMounts,
      '-v',
      `${setupScriptPath}:/setup.sh:Z,ro`,
      '-v',
      `${setupMcpScriptPath}:/setup-mcp.sh:Z,ro`,
      '-v',
      `${iterationJsonPath}:/task/description.json:Z,ro`,
      '-v',
      `${promptsDir}:/prompts:Z,ro`,
      '-w',
      '/workspace',
      'node:24-alpine',
      '/bin/sh',
      '/setup.sh',
      currentUser.uid.toString(),
      currentUser.gid.toString()
    );

    // Background mode execution
    try {
      const containerId = launchSync('docker', dockerArgs)
        .stdout?.toString()
        .trim();

      if (spinner) spinner.success('Container started in background');
      if (!jsonMode) {
        showTips([
          'Use ' + colors.cyan(`rover logs -f ${task.id}`) + ` to monitor logs`,
          'Use ' +
            colors.cyan(`rover inspect ${task.id}`) +
            ` to get task details`,
          'Use ' +
            colors.cyan(`rover list`) +
            ` to check the status of all tasks`,
        ]);
      }

      // Update task metadata with container ID
      updateTaskMetadata(
        taskId,
        {
          containerId: containerId,
          executionStatus: 'running',
          runningAt: new Date().toISOString(),
        },
        jsonMode
      );
    } catch (error: any) {
      if (spinner) spinner.error('Failed to start container in background');
      if (!jsonMode) {
        console.error(
          colors.red('Error starting Docker container:'),
          error.message
        );
      }

      // Reset task to NEW status when container fails to start
      updateTaskMetadata(
        taskId,
        {
          status: 'NEW',
          executionStatus: 'error',
          error: error.message,
          errorAt: new Date().toISOString(),
        },
        jsonMode
      );

      if (!jsonMode) {
        console.log(
          colors.yellow('⚠ There was an error during container creation')
        );
        console.log(colors.gray('  Resetting the task status to "New"'));
        console.log(
          colors.gray('  Use ') +
            colors.cyan(`rover restart ${taskId}`) +
            colors.gray(' to retry execution')
        );
      }

      // TODO: use exitWithError
      process.exit(1);
    }
  } catch (error) {
    if (spinner) spinner.error('Failed to start container');
    if (!jsonMode) {
      console.error(colors.red('Error starting Docker container:'), error);
    }

    // Reset task to NEW status when Docker startup fails
    updateTaskMetadata(
      taskId,
      {
        status: 'NEW',
        executionStatus: 'error',
        error: error instanceof Error ? error.message : String(error),
        errorAt: new Date().toISOString(),
      },
      jsonMode
    );

    if (!jsonMode) {
      console.log(colors.yellow('⚠ Task reset to NEW status'));
      console.log(
        colors.gray('  Use ') +
          colors.cyan(`rover restart ${taskId}`) +
          colors.gray(' to retry execution')
      );
    }

    // TODO: use exitWithError
    process.exit(1);
  }
};

/**
 * Interface for the JSON output
 */
interface TaskTaskOutput extends CLIJsonOutput {
  taskId?: number;
  title?: string;
  description?: string;
  status?: string;
  createdAt?: string;
  startedAt?: string;
  workspace?: string;
  branch?: string;
  savedTo?: string;
}

/**
 * Task commands
 */
export const taskCommand = async (
  initPrompt?: string,
  options: {
    fromGithub?: string;
    yes?: boolean;
    sourceBranch?: string;
    targetBranch?: string;
    agent?: string;
    json?: boolean;
    debug?: boolean;
  } = {}
) => {
  const telemetry = getTelemetry();
  // Extract options
  const { yes, json, fromGithub, debug, sourceBranch, targetBranch, agent } =
    options;

  const jsonOutput: TaskTaskOutput = {
    success: false,
  };

  // Check if rover is initialized
  const roverPath = join(findProjectRoot(), '.rover');
  if (!existsSync(roverPath)) {
    jsonOutput.error = 'Rover is not initialized in this directory';
    exitWithError(jsonOutput, json, {
      tips: ['Run ' + colors.cyan('rover init') + ' first'],
    });
    return;
  }

  let selectedAiAgent = AI_AGENT.Claude;

  // Check if --agent option is provided and validate it
  if (agent) {
    const agentLower = agent.toLowerCase();
    if (agentLower === 'claude') {
      selectedAiAgent = AI_AGENT.Claude;
    } else if (agentLower === 'gemini') {
      selectedAiAgent = AI_AGENT.Gemini;
    } else if (agentLower === 'qwen') {
      selectedAiAgent = AI_AGENT.Qwen;
    } else {
      jsonOutput.error = `Invalid agent: ${agent}. Valid options are: claude, gemini, qwen`;
      exitWithError(jsonOutput, json);
      return;
    }
  } else {
    // Fall back to user settings if no agent specified
    try {
      selectedAiAgent = getUserAIAgent();
    } catch (_err) {
      if (!json) {
        console.log(
          colors.yellow('⚠ Could not load user settings, defaulting to Claude')
        );
      }
    }
  }

  const valid = validations(selectedAiAgent, json);

  if (valid != null) {
    jsonOutput.error = valid.error;
    exitWithError(jsonOutput, json, {
      tips: valid.tips,
    });
    return;
  }

  if (!json) {
    showRoverBanner();
    showRoverChat([
      'hey human! Here you can assign new tasks to an agent.',
      'Add detailed instructions for a better result.',
    ]);
  }

  let description = initPrompt?.trim() || '';
  let skipExpansion = false;
  let taskData: IPromptTask | null = null;

  const git = new Git();

  // Handle --from-github option
  if (fromGithub) {
    const github = new GitHub(false);
    try {
      const issueData = await github.fetchIssue(fromGithub, git.remoteUrl());
      if (issueData) {
        description = `${issueData.title}\n\n${issueData.body}`;
        skipExpansion = true;

        if (!issueData.body || issueData.body.length == 0) {
          jsonOutput.error =
            'The GitHub issue description is empty. Add more details to the issue so the Agent can complete it successfully.';
          exitWithError(jsonOutput, json);
          return;
        }

        taskData = {
          title: issueData.title,
          description,
        };

        if (!json) {
          console.log(colors.green('✓ GitHub issue fetched successfully'));
          console.log(
            colors.gray('├── Title: ') + colors.cyan(issueData.title)
          );
          console.log(
            colors.gray('└── Body: ') +
              colors.white(
                issueData.body.substring(0, 100) +
                  (issueData.body.length > 100 ? '...' : '')
              )
          );
        }
      } else {
        jsonOutput.error = 'Failed to fetch issue from GitHub';
        exitWithError(jsonOutput, json);
        return;
      }
    } catch (err) {
      if (err instanceof GitHubError) {
        jsonOutput.error = `Failed to fetch issue from GitHub: ${err.cause}`;
      } else {
        jsonOutput.error = `Failed to fetch issue from GitHub: ${err}`;
      }

      exitWithError(jsonOutput, json);
      return;
    }
  }

  // Validate branch option and check for uncommitted changes
  let baseBranch = sourceBranch;

  if (sourceBranch) {
    // Validate specified branch exists
    if (!git.branchExists(sourceBranch)) {
      jsonOutput.error = `Branch '${sourceBranch}' does not exist`;
      exitWithError(jsonOutput, json);
      return;
    }
  } else {
    // No branch specified, use current branch
    baseBranch = git.getCurrentBranch();

    // Check for uncommitted changes and warn
    if (git.hasUncommittedChanges()) {
      if (!json) {
        console.log(
          colors.yellow(
            '⚠ Warning: Current branch has uncommitted or untracked changes'
          )
        );
        console.log(
          colors.yellow(
            '  Consider using --source-branch option to specify a clean base branch or stash your changes'
          )
        );
        const initialPrompt = description || initPrompt || '';

        if (initialPrompt.length > 0) {
          console.log(
            colors.gray(`  Example: `) +
              colors.cyan(`rover task --source-branch main "${initialPrompt}"
`)
          );
        } else {
          console.log(
            colors.gray(`  Example: `) +
              colors.cyan(`rover task --source-branch main
`)
          );
        }
      }
    }
  }

  // Display source branch
  if (!json) {
    console.log(
      colors.gray(`Source branch: `) + colors.cyan(`${baseBranch}\n`)
    );
  }

  // Get initial task description - try stdin first if no description provided
  if (
    !fromGithub &&
    (typeof description !== 'string' || description.length == 0)
  ) {
    // Try to read from stdin first
    if (stdinIsAvailable()) {
      const stdinInput = await readFromStdin();
      if (stdinInput) {
        description = stdinInput;
        if (!json) {
          console.log(colors.gray('✓ Read task description from stdin'));
        }
      }
    }

    // If still no description
    if (typeof description !== 'string' || description.length == 0) {
      if (yes) {
        jsonOutput.error =
          'Task description is required in non-interactive mode';
        exitWithError(jsonOutput, json, {
          tips: [
            'Provide a description as an argument using' +
              colors.cyan(' rover task "your task description" --yes'),
          ],
        });
        return;
      }

      try {
        const { input } = await prompt<{ input: string }>({
          type: 'input',
          name: 'input',
          message: 'Describe the task you want to assign:',
          validate: value =>
            value.trim().length > 0 || 'Please provide a description',
        });

        description = input;
      } catch (err) {
        jsonOutput.error = 'Task creation cancelled';
        exitWithWarn('Task creation cancelled', jsonOutput, json, {
          exitCode: 1,
        });
      }
    }
  }

  let satisfied = skipExpansion;

  while (!satisfied) {
    // Expand task with selected AI provider
    const spinner = !json
      ? yoctoSpinner({
          text: `Expanding task description with ${selectedAiAgent.charAt(0).toUpperCase() + selectedAiAgent.slice(1)}...`,
        }).start()
      : null;

    try {
      const aiAgent = getAIAgentTool(selectedAiAgent);
      const expanded = await aiAgent.expandTask(
        taskData ? `${taskData.title}: ${taskData.description}` : description,
        findProjectRoot()
      );

      if (expanded) {
        if (spinner) spinner.success('Done!');
        taskData = expanded;

        // Skip confirmation if using GitHub issue
        if (skipExpansion || yes) {
          satisfied = true;
        } else {
          // Display the expanded task
          if (!json) {
            console.log('\n' + colors.white.bold('Task Details:'));
            console.log(
              colors.gray('├── Title: ') + colors.cyan(taskData.title)
            );
            console.log(
              colors.gray('└── Description: ') +
                colors.white(taskData.description)
            );
          }

          // Ask for confirmation
          let confirmValue = 'cancel';
          try {
            const { confirm } = await prompt<{ confirm: string }>({
              type: 'select',
              name: 'confirm',
              message: '\nAre you satisfied with this task?',
              choices: [
                { name: 'yes', message: 'Yes, looks good!' },
                { name: 'refine', message: 'No, I want to add more details' },
                { name: 'cancel', message: 'Cancel task creation' },
              ],
            });
            confirmValue = confirm;
          } catch (err) {
            // Just cancel it
            confirmValue = 'cancel';
          }

          if (confirmValue === 'yes') {
            satisfied = true;
          } else if (confirmValue === 'refine') {
            // Get additional details
            try {
              const { additionalInfo } = await prompt<{
                additionalInfo: string;
              }>({
                type: 'input',
                name: 'additionalInfo',
                message: 'Provide additional instructions:',
                validate: value =>
                  value.trim().length > 0 ||
                  'Please provide additional information',
              });

              // Update the description for next iteration
              taskData.description = `${taskData.description}. Additional instructions: ${additionalInfo}`;
            } catch (err) {
              jsonOutput.error = 'Task creation cancelled';
              exitWithWarn('Task creation cancelled', jsonOutput, json, {
                exitCode: 1,
              });
              return;
            }
          } else {
            // Cancel
            jsonOutput.error = 'Task creation cancelled';
            exitWithWarn('Task creation cancelled', jsonOutput, json, {
              exitCode: 1,
            });
            return;
          }
        }
      } else {
        if (spinner) spinner.error('Failed to expand task');
        if (!json) {
          console.log(
            colors.yellow(
              `\n⚠ ${selectedAiAgent.charAt(0).toUpperCase() + selectedAiAgent.slice(1)} AI is not available. Creating task with original description.`
            )
          );
        }
        taskData = {
          title: description.split(' ').slice(0, 5).join(' '),
          description: description,
        };
        satisfied = true;
      }
    } catch (error) {
      if (spinner)
        spinner.error('Failed to expand task. Continuing with original values');

      // Fallback to manual task creation
      taskData = {
        title: description.split(' ').slice(0, 5).join(' '),
        description: description,
      };
      satisfied = true;
    }
  }

  if (taskData) {
    // Generate auto-increment ID for the task
    const taskId = getNextTaskId();

    // Create .rover/tasks directory structure
    const endorPath = join(findProjectRoot(), '.rover');
    const tasksPath = join(endorPath, 'tasks');
    const taskPath = join(tasksPath, taskId.toString());

    // Ensure directories exist
    if (!existsSync(endorPath)) {
      mkdirSync(endorPath, { recursive: true });
    }
    if (!existsSync(tasksPath)) {
      mkdirSync(tasksPath, { recursive: true });
    }
    mkdirSync(taskPath, { recursive: true });

    // Create task using TaskDescription class
    const task = TaskDescription.create({
      id: taskId,
      title: taskData.title,
      description: taskData.description,
      agent: selectedAiAgent,
      sourceBranch: sourceBranch,
    });

    // Setup git worktree and branch
    const worktreePath = join(taskPath, 'workspace');
    const branchName = targetBranch || generateBranchName(taskId);

    try {
      git.createWorktree(worktreePath, branchName, baseBranch);

      // Copy user .env development files
      copyEnvironmentFiles(findProjectRoot(), worktreePath);
    } catch (error) {
      jsonOutput.error = 'Error creating git workspace: ' + error;
      exitWithError(jsonOutput, json);
      return;
    }

    const iterationPath = join(
      taskPath,
      'iterations',
      task.iterations.toString()
    );
    mkdirSync(iterationPath, { recursive: true });

    // Create initial iteration.json for the first iteration
    IterationConfig.createInitial(
      iterationPath,
      task.id,
      task.title,
      task.description
    );

    // Update task with workspace information
    task.setWorkspace(worktreePath, branchName);
    task.markInProgress();

    if (!json) {
      console.log(colors.bold.white('\n🚀 Task Created'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + colors.white(task.title));
      console.log(
        colors.gray('├── Workspace: ') + colors.cyan(task.worktreePath)
      );
      console.log(colors.gray('└── Branch: ') + colors.cyan(task.branchName));
    }

    // Track new task event
    telemetry?.eventNewTask(
      options.fromGithub != null
        ? NewTaskProvider.GITHUB
        : NewTaskProvider.INPUT
    );

    // Complete JSON information
    jsonOutput.taskId = task.id;
    jsonOutput.title = task.title;
    jsonOutput.description = task.description;
    jsonOutput.status = task.status;
    jsonOutput.createdAt = task.createdAt;
    jsonOutput.startedAt = task.startedAt;
    jsonOutput.workspace = task.worktreePath;
    jsonOutput.branch = task.branchName;
    jsonOutput.savedTo = `.rover/tasks/${taskId}/description.json`;

    // Start Docker container for task execution
    try {
      await startDockerExecution(
        taskId,
        task,
        worktreePath,
        iterationPath,
        selectedAiAgent,
        json,
        debug
      );
    } catch (_err) {
      // If Docker execution fails to start, reset task to NEW status
      task.resetToNew();

      jsonOutput.status = task.status;
      jsonOutput.error =
        "Task was created, but reset to 'New' due to an error running the container";
      exitWithWarn(jsonOutput.error, jsonOutput, json, {
        exitCode: 1,
        tips: [
          'Use ' + colors.cyan(`rover restart ${taskId}`) + ' to retry it',
        ],
      });
      return;
    }

    jsonOutput.success = true;

    exitWithSuccess('Task was created successfully', jsonOutput, json, {
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
  } else {
    // This error should be really weird. Keeping this branch just in case,
    // but I don't expect it to trigger because we have several fallbacks
    jsonOutput.error = 'There was an issue retrieving the task information';
    exitWithError(jsonOutput, json);
  }

  await telemetry?.shutdown();
};
