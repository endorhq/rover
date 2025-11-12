import enquirer from 'enquirer';
import colors from 'ansi-colors';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getNextTaskId } from '../utils/task-id.js';
import { homedir } from 'node:os';
import { getAIAgentTool, getUserAIAgent } from '../lib/agents/index.js';
import { TaskDescriptionManager } from 'rover-schemas';
import { createSandbox } from '../lib/sandbox/index.js';
import { AI_AGENT } from 'rover-common';
import { IterationManager } from 'rover-schemas';
import { generateBranchName } from '../utils/branch-name.js';
import {
  findProjectRoot,
  ProcessManager,
  showProperties,
  Git,
} from 'rover-common';
import { getTelemetry } from '../lib/telemetry.js';
import { NewTaskProvider } from 'rover-telemetry';
import { readFromStdin, stdinIsAvailable } from '../utils/stdin.js';
import { CLIJsonOutput } from '../types.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { GitHub, GitHubError } from '../lib/github.js';
import { copyEnvironmentFiles } from '../utils/env-files.js';
import { initWorkflowStore } from '../lib/workflow.js';
import { WorkflowManager } from 'rover-schemas';

const { prompt } = enquirer;

// Default values
const DEFAULT_WORKFLOW = 'swe';

type validationResult = {
  error: string;
  tips?: string[];
} | null;

/**
 * Command validations.
 */
const validations = (selectedAiAgent?: string): validationResult => {
  // Check AI agent credentials based on selected agent
  if (selectedAiAgent === 'claude') {
    const claudeFile = join(homedir(), '.claude.json');

    if (!existsSync(claudeFile)) {
      return {
        error: 'Claude configuration not found',
        tips: ['Run ' + colors.cyan('claude') + ' first to configure it'],
      };
    }
  } else if (selectedAiAgent === 'codex') {
    const codexCreds = join(homedir(), '.codex', 'auth.json');

    if (!existsSync(codexCreds)) {
      return {
        error: 'Codex credentials not found',
        tips: [
          'Run ' +
            colors.cyan('codex') +
            ' first to set up credentials, using the' +
            colors.cyan('/auth') +
            ' command',
        ],
      };
    }
  } else if (selectedAiAgent === 'cursor') {
    const cursorConfig = join(homedir(), '.cursor', 'cli-config.json');
    const cursorCreds = join(homedir(), '.config', 'cursor', 'auth.json');

    if (!existsSync(cursorConfig)) {
      return {
        error: 'Cursor configuration not found',
        tips: ['Run ' + colors.cyan('cursor-agent') + ' first to configure it'],
      };
    }

    if (!existsSync(cursorCreds)) {
      return {
        error: 'Cursor credentials not found',
        tips: [
          'Run ' + colors.cyan('cursor-agent') + ' first to set up credentials',
        ],
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
    if (TaskDescriptionManager.exists(taskId)) {
      const task = TaskDescriptionManager.load(taskId);

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
 * Command options
 */
interface TaskOptions {
  workflow?: string;
  fromGithub?: string;
  yes?: boolean;
  sourceBranch?: string;
  targetBranch?: string;
  agent?: string;
  json?: boolean;
  debug?: boolean;
}

/**
 * Task commands
 */
export const taskCommand = async (
  initPrompt?: string,
  options: TaskOptions = {}
) => {
  const telemetry = getTelemetry();
  // Extract options
  const { yes, json, fromGithub, debug, sourceBranch, targetBranch, agent } =
    options;

  const workflowName = options.workflow || DEFAULT_WORKFLOW;

  const jsonOutput: TaskTaskOutput = {
    success: false,
  };

  // Check if rover is initialized
  const roverPath = join(findProjectRoot(), '.rover');
  if (!existsSync(roverPath)) {
    jsonOutput.error = 'Rover is not initialized in this directory';
    await exitWithError(jsonOutput, json, {
      tips: ['Run ' + colors.cyan('rover init') + ' first'],
      telemetry,
    });
    return;
  }

  let selectedAiAgent = AI_AGENT.Claude;

  // Check if --agent option is provided and validate it
  if (agent) {
    const agentLower = agent.toLowerCase();
    if (agentLower === 'claude') {
      selectedAiAgent = AI_AGENT.Claude;
    } else if (agentLower === 'codex') {
      selectedAiAgent = AI_AGENT.Codex;
    } else if (agentLower === 'cursor') {
      selectedAiAgent = AI_AGENT.Cursor;
    } else if (agentLower === 'gemini') {
      selectedAiAgent = AI_AGENT.Gemini;
    } else if (agentLower === 'qwen') {
      selectedAiAgent = AI_AGENT.Qwen;
    } else {
      jsonOutput.error = `Invalid agent: ${agent}. Valid options are: ${Object.values(AI_AGENT).join(', ')}`;
      await exitWithError(jsonOutput, json, { telemetry });
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

  const valid = validations(selectedAiAgent);

  if (valid != null) {
    jsonOutput.error = valid.error;
    await exitWithError(jsonOutput, json, {
      tips: valid.tips,
      telemetry,
    });
    return;
  }

  // Load the workflow
  let workflow: WorkflowManager;

  try {
    const workflowStore = initWorkflowStore();
    const loadedWorkflow = workflowStore.getWorkflow(workflowName);

    if (loadedWorkflow) {
      workflow = loadedWorkflow;
    } else {
      jsonOutput.error = `Could no load the '${workflowName}' workflow`;
      await exitWithError(jsonOutput, json, { telemetry });
      return;
    }
  } catch (err) {
    jsonOutput.error = `There was an error loading the '${workflowName}' workflow: ${err}`;
    await exitWithError(jsonOutput, json, { telemetry });
    return;
  }

  if (workflow == null) {
    jsonOutput.error = `The workflow ${workflow} does not exist`;
    await exitWithError(jsonOutput, json, { telemetry });
    return;
  }

  // Many workflows require instructions and this is the default input we collect
  // from the CLI. We might revisit it in the future when we have more workflows.
  let description = initPrompt?.trim() || '';

  // Workflow inputs' data
  const inputs = workflow.inputs;
  const requiredInputs = (inputs || [])
    .filter(el => el.required)
    .map(el => el.name);
  const descriptionOnlyWorkflow =
    requiredInputs.length === 1 && requiredInputs[0] === 'description';
  const inputsData: Map<string, string> = new Map();

  // Validate branch option and check for uncommitted changes
  const git = new Git();
  let baseBranch = sourceBranch;

  if (sourceBranch) {
    // Validate specified branch exists
    if (!git.branchExists(sourceBranch)) {
      jsonOutput.error = `Branch '${sourceBranch}' does not exist`;
      await exitWithError(jsonOutput, json, { telemetry });
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
            '\n⚠ Warning: Current branch has uncommitted or untracked changes'
          )
        );
        console.log(
          colors.yellow(
            '  Consider using --source-branch option to specify a clean base branch or stash your changes'
          )
        );
        console.log(
          colors.gray(`  Example: `) +
            colors.cyan(`rover task --source-branch main`)
        );
      }
    }
  }

  // Display extra information
  if (!json) {
    const props: Record<string, string> = {
      ['Source Branch']: baseBranch!,
      ['Workflow']: workflowName,
    };

    if (description.length > 0) {
      props['Description'] = description!;
    }

    showProperties(props, { addLineBreak: true });
  }

  // We need to process the workflow inputs. We will ask users to provide this
  // information or load it as a JSON from the stdin.
  if (inputs && inputs.length > 0) {
    if (stdinIsAvailable()) {
      const stdinInput = await readFromStdin();
      if (stdinInput) {
        try {
          const parsed = JSON.parse(stdinInput);

          for (const key in parsed) {
            inputsData.set(key, parsed[key]);

            if (key == 'description') {
              description = parsed[key];
            }
          }

          if (!json) {
            console.log(colors.gray('✓ Read task description from stdin'));
          }
        } catch (err) {
          // Assume the text is just the description
          description = stdinInput;
          inputsData.set('description', description);
          if (!json) {
            showProperties(
              {
                Description: description,
              },
              { addLineBreak: false }
            );
          }
        }
      } else if (description != null && description.length > 0) {
        // There are cases like running the CLI from the extension that might
        // configure an empty stdin, while passing the `description` as argument.
        // In that case, we also load the description
        inputsData.set('description', description);
      }
    } else if (fromGithub != null) {
      // Load the inputs from GitHub
      const github = new GitHub(false);

      try {
        const issueData = await github.fetchIssue(fromGithub, git.remoteUrl());
        if (issueData) {
          description = issueData.body;
          inputsData.set('description', description);

          if (!issueData.body || issueData.body.length == 0) {
            jsonOutput.error =
              'The GitHub issue description is empty. Add more details to the issue so the Agent can complete it successfully.';
            await exitWithError(jsonOutput, json, { telemetry });
            return;
          }

          // Now, let's ask an agent to extract the required inputs from the issue body.
          if (inputs && inputs.length > 0) {
            if (descriptionOnlyWorkflow) {
              // We already have the description!
              inputsData.set('description', description);
              if (!json) {
                showProperties(
                  {
                    Description: description,
                  },
                  { addLineBreak: false }
                );
              }
            } else {
              if (!json) {
                console.log(
                  colors.gray('\nExtracting workflow inputs from issue...')
                );
              }

              const agentTool = getAIAgentTool(selectedAiAgent);
              const extractedInputs = await agentTool.extractGithubInputs(
                issueData.body,
                inputs.filter(el => el.name !== 'description')
              );

              if (extractedInputs) {
                for (const key in extractedInputs) {
                  if (extractedInputs[key] !== null) {
                    inputsData.set(key, String(extractedInputs[key]));
                  }
                }

                if (!json) {
                  console.log(
                    colors.green('✓ Workflow inputs extracted successfully')
                  );
                }
              } else {
                if (!json) {
                  console.log(
                    colors.yellow(
                      '⚠ Could not extract workflow inputs from issue'
                    )
                  );
                }

                jsonOutput.error =
                  'Failed to fetch the workflow inputs from issue';
                await exitWithError(jsonOutput, json, { telemetry });
                return;
              }
            }
          }
        } else {
          jsonOutput.error = 'Failed to fetch issue from GitHub';
          await exitWithError(jsonOutput, json, { telemetry });
          return;
        }
      } catch (err) {
        if (err instanceof GitHubError) {
          jsonOutput.error = `Failed to fetch issue from GitHub: ${err.cause}`;
        } else {
          jsonOutput.error = `Failed to fetch issue from GitHub: ${err}`;
        }

        await exitWithError(jsonOutput, json, { telemetry });
        return;
      }
    } else {
      const questions = [];

      // By default, we always ask for a description.
      if (description == null || description.length == 0) {
        questions.push({
          type: 'input',
          name: 'description',
          message: 'Describe the task you want to complete',
        });
      } else {
        inputsData.set('description', description);
      }

      // Build the questions and pass them to enquirer
      for (const key in inputs) {
        const input = inputs[key];

        // We are already asking of providing it.
        if (input.name == 'description') {
          continue;
        }

        let enquirerType;
        switch (input.type) {
          case 'string':
          case 'number':
            enquirerType = 'input';
            break;
          case 'boolean':
            enquirerType = 'confirm';
            break;
          default:
            enquirerType = 'input';
            break;
        }

        const question = {
          type: enquirerType,
          name: input.name,
          message: input.label || input.description,
        };

        questions.push(question);
      }

      if (questions.length > 0) {
        try {
          console.log();
          const response: Record<string, string | number> =
            await prompt(questions);
          for (const key in response) {
            inputsData.set(key, String(response[key]));

            if (key == 'description') {
              description = String(response[key]);
            }
          }
        } catch (err) {
          jsonOutput.error = 'Task creation cancelled';
          await exitWithWarn('Task creation cancelled', jsonOutput, json, {
            exitCode: 1,
            telemetry,
          });
        }
      }
    }

    // Validate
    const missing: string[] = [];
    requiredInputs.forEach(name => {
      if (!inputsData.has(name)) {
        missing.push(name);
      }
    });

    if (missing.length > 0) {
      jsonOutput.error = `The workflow requires the following missing properties: ${missing.join(', ')}`;
      await exitWithError(jsonOutput, json, { telemetry });
      return;
    }
  }

  if (description.length > 0) {
    const processManager = json
      ? undefined
      : new ProcessManager({ title: 'Create new task in the background' });
    processManager?.start();

    processManager?.addItem(`Expand task information using ${selectedAiAgent}`);

    // Extract the title and description based on current data.
    const agentTool = getAIAgentTool(selectedAiAgent);
    await agentTool.checkAgent();
    const expandedTask = await agentTool.expandTask(
      description,
      findProjectRoot()
    );

    processManager?.completeLastItem();

    inputsData.set('description', expandedTask!.description);
    inputsData.set('title', expandedTask!.title);

    processManager?.addItem('Create the task workspace');

    // Generate auto-increment ID for the task
    const taskId = getNextTaskId();

    // Create .rover/tasks directory structure
    const roverPath = join(findProjectRoot(), '.rover');
    const tasksPath = join(roverPath, 'tasks');
    const taskPath = join(tasksPath, taskId.toString());

    // Ensure directories exist
    if (!existsSync(roverPath)) {
      mkdirSync(roverPath, { recursive: true });
    }
    if (!existsSync(tasksPath)) {
      mkdirSync(tasksPath, { recursive: true });
    }
    mkdirSync(taskPath, { recursive: true });

    // Create task using TaskDescription class
    const task = TaskDescriptionManager.create({
      id: taskId,
      title: expandedTask!.title,
      description: expandedTask!.description,
      inputs: inputsData,
      workflowName: workflowName,
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
      await exitWithError(jsonOutput, json, { telemetry });
      return;
    }

    processManager?.updateLastItem(
      `Create the task workspace | Branch: ${branchName}`
    );
    processManager?.completeLastItem();

    processManager?.addItem('Complete task creation');

    const iterationPath = join(
      taskPath,
      'iterations',
      task.iterations.toString()
    );
    mkdirSync(iterationPath, { recursive: true });

    // Create initial iteration.json for the first iteration
    IterationManager.createInitial(
      iterationPath,
      task.id,
      task.title,
      task.description
    );

    // Update task with workspace information
    task.setWorkspace(worktreePath, branchName);
    task.markInProgress();

    // Track new task event
    telemetry?.eventNewTask(
      options.fromGithub != null
        ? NewTaskProvider.GITHUB
        : NewTaskProvider.INPUT,
      workflowName
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

    processManager?.completeLastItem();

    // Start sandbox container for task execution
    try {
      const sandbox = await createSandbox(task, processManager);
      const containerId = await sandbox.createAndStart();

      updateTaskMetadata(
        task.id,
        {
          containerId,
          executionStatus: 'running',
          runningAt: new Date().toISOString(),
        },
        json
      );

      processManager?.addItem('Task started in background');
      processManager?.completeLastItem();
      processManager?.finish();
    } catch (_err) {
      // If Docker execution fails to start, reset task to NEW status
      task.resetToNew();

      processManager?.addItem('Task started in background');
      processManager?.failLastItem();
      processManager?.finish();

      jsonOutput.status = task.status;
      jsonOutput.error =
        "Task was created, but reset to 'New' due to an error running the container";
      await exitWithWarn(jsonOutput.error, jsonOutput, json, {
        exitCode: 1,
        tips: [
          'Use ' + colors.cyan(`rover restart ${taskId}`) + ' to retry it',
        ],
        telemetry,
      });
      return;
    }

    jsonOutput.success = true;

    await exitWithSuccess('Task was created successfully', jsonOutput, json, {
      tips: [
        'Use ' + colors.cyan('rover list') + ' to check the list of tasks',
        'Use ' +
          colors.cyan(`rover logs -f ${task.id}`) +
          ' to watch the task logs',
      ],
      telemetry,
    });
  } else {
    jsonOutput.error = `Could not determine the description. Please, provide it.`;
    await exitWithError(jsonOutput, json, { telemetry });
    return;
  }

  await telemetry?.shutdown();
};
