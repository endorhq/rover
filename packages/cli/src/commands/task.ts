import enquirer from 'enquirer';
import colors from 'ansi-colors';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getNextTaskId } from '../utils/task-id.js';
import { homedir, tmpdir, userInfo } from 'node:os';
import { getAIAgentTool, getUserAIAgent } from '../lib/agents/index.js';
import { TaskDescription } from '../lib/description.js';
import { SetupBuilder } from '../lib/setup.js';
import { AI_AGENT, ProjectConfig } from '../lib/config.js';
import { IterationConfig } from '../lib/iteration.js';
import { generateBranchName } from '../utils/branch-name.js';
import {
  findProjectRoot,
  launchSync,
  ProcessManager,
  showProperties,
} from 'rover-common';
import { getTelemetry } from '../lib/telemetry.js';
import { NewTaskProvider } from 'rover-telemetry';
import { Git } from 'rover-common';
import { readFromStdin, stdinIsAvailable } from '../utils/stdin.js';
import { CLIJsonOutput } from '../types.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { GitHub, GitHubError } from '../lib/github.js';
import { copyEnvironmentFiles } from '../utils/env-files.js';
import {
  parseCustomEnvironmentVariables,
  loadEnvsFile,
} from '../utils/env-variables.js';
import { loadWorkflowByName } from '../lib/workflow.js';
import { WorkflowManager } from 'rover-schemas';

const { prompt } = enquirer;

// Default values
const AGENT_IMAGE = 'ghcr.io/endorhq/rover/node:v1.3.0';
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

function catFile(image: string, file: string): string {
  try {
    return (
      launchSync('docker', [
        'run',
        '--entrypoint',
        '/bin/sh',
        '--rm',
        image,
        '-c',
        `/bin/cat ${file}`,
      ])
        .stdout?.toString()
        .trim() || ''
    );
  } catch (error) {
    return '';
  }
}

function imageUids(image: string): Map<number, string> {
  const passwdContent = catFile(image, '/etc/passwd');
  const uidMap = new Map<number, string>();

  if (!passwdContent) {
    return uidMap;
  }

  const lines = passwdContent.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const fields = line.split(':');
    if (fields.length >= 3) {
      const username = fields[0];
      const uid = parseInt(fields[2], 10);
      if (!isNaN(uid)) {
        uidMap.set(uid, username);
      }
    }
  }

  return uidMap;
}

function imageGids(image: string): Map<number, string> {
  const groupContent = catFile(image, '/etc/group');
  const gidMap = new Map<number, string>();

  if (!groupContent) {
    return gidMap;
  }

  const lines = groupContent.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const fields = line.split(':');
    if (fields.length >= 3) {
      const groupname = fields[0];
      const gid = parseInt(fields[2], 10);
      if (!isNaN(gid)) {
        gidMap.set(gid, groupname);
      }
    }
  }

  return gidMap;
}

type CurrentUser = string;

export function etcPasswdWithUserInfo(
  image: string,
  userInfo: { uid: number; gid: number }
): [string, CurrentUser] {
  const originalPasswd = catFile(image, '/etc/passwd');
  const existingUids = imageUids(image);

  // Check if current user already exists in the image
  if (existingUids.has(userInfo.uid)) {
    return [originalPasswd, existingUids.get(userInfo.uid)!];
  }

  // Create entry for current user
  const userEntry = `agent:x:${userInfo.uid}:${userInfo.gid}:agent:/home/agent:/bin/sh`;

  return [originalPasswd + '\n' + userEntry + '\n', 'agent'];
}

type CurrentGroup = string;

export function etcGroupWithUserInfo(
  image: string,
  userInfo: { uid: number; gid: number }
): [string, CurrentGroup] {
  const originalGroup = catFile(image, '/etc/group');
  const existingGids = imageGids(image);

  // Check if current group already exists in the image
  if (existingGids.has(userInfo.gid)) {
    return [originalGroup, existingGids.get(userInfo.gid)!];
  }

  // Create entry for current group
  const groupEntry = `agent:x:${userInfo.gid}:agent`;

  return [originalGroup + '\n' + groupEntry + '\n', 'agent'];
}

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
  debug?: boolean,
  processManager?: ProcessManager
) => {
  const containerName = `rover-task-${taskId}-${task.iterations}`;

  processManager?.addItem(`Prepare sandbox container | Name: ${containerName}`);

  try {
    // Check if Docker is available
    launchSync('docker', ['--version']);
  } catch (error) {
    if (!jsonMode) {
      processManager?.failLastItem();

      console.log(colors.red('\n✗ Docker is not available'));
      console.log(
        colors.gray('  Please install Docker to use automated task execution')
      );
    }
    return;
  }

  // Load task description
  const iterationJsonPath = join(iterationPath, 'iteration.json');

  // Generate setup script using SetupBuilder
  const setupBuilder = new SetupBuilder(task, selectedAiAgent);
  const entrypointScriptPath = setupBuilder.generateEntrypoint();
  const inputsPath = setupBuilder.generateInputs();
  const workflowPath = setupBuilder.saveWorkflow();

  // Get agent-specific Docker mounts
  const agent = getAIAgentTool(selectedAiAgent);
  const dockerMounts: string[] = agent.getContainerMounts();
  const envVariables: string[] = agent.getEnvironmentVariables();

  // Load project config and merge custom environment variables
  const projectRoot = findProjectRoot();
  let customEnvVariables: string[] = [];

  if (ProjectConfig.exists()) {
    try {
      const projectConfig = ProjectConfig.load();

      // Parse custom envs array
      if (projectConfig.envs && projectConfig.envs.length > 0) {
        customEnvVariables = parseCustomEnvironmentVariables(
          projectConfig.envs
        );
      }

      // Load envs from file
      if (projectConfig.envsFile) {
        const fileEnvVariables = loadEnvsFile(
          projectConfig.envsFile,
          projectRoot
        );
        customEnvVariables = [...customEnvVariables, ...fileEnvVariables];
      }
    } catch (error) {
      // Silently skip if there's an error loading project config
    }
  }

  // Merge agent environment variables with custom environment variables
  // IMPORTANT: Custom environment variables are appended after agent defaults.
  // In Docker, when the same environment variable appears multiple times, the last
  // occurrence takes precedence. This means custom environment variables will
  // override agent defaults if there are conflicts, which is the desired behavior.
  const allEnvVariables = [...envVariables, ...customEnvVariables];

  processManager?.completeLastItem();
  processManager?.addItem(`Start sandbox container | Name: ${containerName}`);

  // Clean up any existing container with same name
  try {
    launchSync('docker', ['rm', '-f', containerName]);
  } catch (error) {
    // Container doesn't exist, which is fine
  }

  try {
    let isDockerRootless = false;

    const dockerInfo = launchSync('docker', ['info', '-f', 'json']).stdout;
    if (dockerInfo) {
      const info = JSON.parse(dockerInfo.toString());
      isDockerRootless = (info?.SecurityOptions || []).some((value: string) =>
        value.includes('rootless')
      );
    }

    // Build Docker run command with mounts
    const dockerArgs = ['run', '--name', containerName, '-d'];

    const userInfo_ = userInfo();

    // If we cannot retrieve the UID in the current environment,
    // set it to 1000, so that the Rover agent container will be
    // using this unprivileged UID. This happens typically on
    // environments such as Windows.
    if (userInfo_.uid === -1) {
      userInfo_.uid = 1000;
    }

    // If we cannot retrieve the GID in the current environment,
    // set it to 1000, so that the Rover agent container will be
    // using this unprivileged GID. This happens typically on
    // environments such as Windows.
    if (userInfo_.gid === -1) {
      userInfo_.gid = 1000;
    }

    const userCredentialsTempPath = mkdtempSync(join(tmpdir(), 'rover-'));
    const etcPasswd = join(userCredentialsTempPath, 'passwd');
    const [etcPasswdContents, username] = etcPasswdWithUserInfo(
      AGENT_IMAGE,
      userInfo_
    );
    writeFileSync(etcPasswd, etcPasswdContents);

    const etcGroup = join(userCredentialsTempPath, 'group');
    const [etcGroupContents, group] = etcGroupWithUserInfo(
      AGENT_IMAGE,
      userInfo_
    );
    writeFileSync(etcGroup, etcGroupContents);

    dockerArgs.push(
      '-v',
      `${etcPasswd}:/etc/passwd:Z,ro`,
      '-v',
      `${etcGroup}:/etc/group:Z,ro`,
      '--user',
      `${userInfo_.uid}:${userInfo_.gid}`,
      '-v',
      `${worktreePath}:/workspace:Z,rw`,
      '-v',
      `${iterationPath}:/output:Z,rw`,
      ...dockerMounts,
      '-v',
      `${entrypointScriptPath}:/entrypoint.sh:Z,ro`,
      '-v',
      `${workflowPath}:/workflow.yml:Z,ro`,
      '-v',
      `${inputsPath}:/inputs.json:Z,ro`,
      '-v',
      `${iterationJsonPath}:/task/description.json:Z,ro`,
      ...allEnvVariables,
      '-w',
      '/workspace',
      '--entrypoint',
      '/entrypoint.sh',
      AGENT_IMAGE,
      'rover-agent',
      'run',
      '/workflow.yml',
      '--agent-tool',
      selectedAiAgent,
      '--task-id',
      taskId.toString(),
      '--status-file',
      '/output/status.json',
      '--output',
      '/output',
      '--inputs-json',
      '/inputs.json'
    );

    // Background mode execution
    try {
      const containerId = launchSync('docker', dockerArgs)
        .stdout?.toString()
        .trim();

      processManager?.completeLastItem();

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
      processManager?.failLastItem();
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
    processManager?.failLastItem();
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
    } else if (agentLower === 'codex') {
      selectedAiAgent = AI_AGENT.Codex;
    } else if (agentLower === 'gemini') {
      selectedAiAgent = AI_AGENT.Gemini;
    } else if (agentLower === 'qwen') {
      selectedAiAgent = AI_AGENT.Qwen;
    } else {
      jsonOutput.error = `Invalid agent: ${agent}. Valid options are: claude, codex, gemini, qwen`;
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

  const valid = validations(selectedAiAgent);

  if (valid != null) {
    jsonOutput.error = valid.error;
    exitWithError(jsonOutput, json, {
      tips: valid.tips,
    });
    return;
  }

  // Load the workflow
  let workflow: WorkflowManager;

  try {
    const loadedWorkflow = loadWorkflowByName(workflowName);

    if (loadedWorkflow) {
      workflow = loadedWorkflow;
    } else {
      jsonOutput.error = `Could no load the '${workflowName}' workflow`;
      exitWithError(jsonOutput, json);
      return;
    }
  } catch (err) {
    jsonOutput.error = `There was an error loading the '${workflowName}' workflow: ${err}`;
    exitWithError(jsonOutput, json);
    return;
  }

  if (workflow == null) {
    jsonOutput.error = `The workflow ${workflow} does not exist`;
    exitWithError(jsonOutput, json);
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
  const inputsData: Map<string, string> = new Map();

  // Validate branch option and check for uncommitted changes
  const git = new Git();
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
            exitWithError(jsonOutput, json);
            return;
          }

          // Now, let's ask an agent to extract the required inputs from the issue body.
          if (inputs && inputs.length > 0) {
            if (inputs.length == 1 && inputs[0].name === 'description') {
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
                exitWithError(jsonOutput, json);
                return;
              }
            }
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
          exitWithWarn('Task creation cancelled', jsonOutput, json, {
            exitCode: 1,
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
      exitWithError(jsonOutput, json);
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
      exitWithError(jsonOutput, json);
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
    IterationConfig.createInitial(
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

    processManager?.completeLastItem();

    // Start Docker container for task execution
    try {
      await startDockerExecution(
        taskId,
        task,
        worktreePath,
        iterationPath,
        selectedAiAgent,
        json,
        debug,
        processManager
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
      ],
    });
  } else {
    jsonOutput.error = `Could not determine the description. Please, provide it.`;
    exitWithError(jsonOutput, json);
    return;
  }

  await telemetry?.shutdown();
};
