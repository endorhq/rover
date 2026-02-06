import enquirer from 'enquirer';
import colors from 'ansi-colors';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  getAIAgentTool,
  getUserAIAgent,
  getUserDefaultModel,
} from '../lib/agents/index.js';
import {
  ProjectConfigManager,
  IterationManager,
  type WorkflowManager,
  AI_AGENT,
  ProcessManager,
  showProperties,
  Git,
  type ProjectManager,
  ContextManager,
  generateContextIndex,
  ContextFetchError,
  registerBuiltInProviders,
  type ContextIndexOptions,
} from 'rover-core';
import type { NetworkConfig, NetworkMode } from 'rover-schemas';
import {
  parseAgentString,
  formatAgentWithModel,
  type ParsedAgent,
} from '../utils/agent-parser.js';
import { createSandbox } from '../lib/sandbox/index.js';
import { resolveAgentImage } from '../lib/sandbox/container-common.js';
import { generateBranchName } from '../utils/branch-name.js';
import { getTelemetry } from '../lib/telemetry.js';
import { NewTaskProvider } from 'rover-telemetry';
import { readFromStdin, stdinIsAvailable } from '../utils/stdin.js';
import type { TaskTaskOutput } from '../output-types.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { GitHub, GitHubError } from '../lib/github.js';
import { copyEnvironmentFiles } from '../utils/env-files.js';
import { initWorkflowStore } from '../lib/workflow.js';
import {
  setJsonMode,
  requireProjectContext,
  isVerbose,
} from '../lib/context.js';
import type { CommandDefinition } from '../types.js';

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

    if (!existsSync(cursorConfig)) {
      return {
        error: 'Cursor configuration not found',
        tips: ['Run ' + colors.cyan('cursor-agent') + ' first to configure it'],
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
  project: ProjectManager,
  taskId: number,
  updates: any,
  jsonMode?: boolean
) => {
  try {
    const task = project.getTask(taskId);
    if (task) {
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
        task.setContainerInfo(
          updates.containerId,
          updates.executionStatus,
          updates.sandboxMetadata
        );
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
 * Command options
 */
interface TaskOptions {
  workflow?: string;
  fromGithub?: string;
  includeComments?: boolean;
  yes?: boolean;
  sourceBranch?: string;
  targetBranch?: string;
  agent?: string[];
  json?: boolean;
  sandboxExtraArgs?: string;
  networkMode?: NetworkMode;
  networkAllow?: string[];
  networkBlock?: string[];
  context?: string[];
  contextTrustAuthors?: string;
  contextTrustAllAuthors?: boolean;
}

/**
 * Format a date string to a more readable format (YYYY-MM-DD)
 */
const formatCommentDate = (dateString: string): string => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  } catch {
    return dateString;
  }
};

/**
 * Format GitHub comments as markdown to append to the issue body
 */
const formatCommentsAsMarkdown = (
  comments: Array<{ author: string; body: string; createdAt: string }>
): string => {
  if (!comments || comments.length === 0) return '';

  const formattedComments = comments
    .map(comment => {
      const date = formatCommentDate(comment.createdAt);
      const dateStr = date ? ` (${date})` : '';
      return `**@${comment.author}**${dateStr}:\n${comment.body}`;
    })
    .join('\n\n');

  return `\n\n---\n## Comments\n\n${formattedComments}`;
};

/**
 * Build NetworkConfig from CLI options
 */
const buildNetworkConfig = (
  options: TaskOptions
): NetworkConfig | undefined => {
  const { networkMode, networkAllow, networkBlock } = options;

  // If no network options specified, return undefined (use project config)
  if (!networkMode && !networkAllow?.length && !networkBlock?.length) {
    return undefined;
  }

  // Determine the mode
  let mode: NetworkMode = 'allowall';
  if (networkMode) {
    mode = networkMode;
  } else if (networkAllow?.length) {
    mode = 'allowlist';
  } else if (networkBlock?.length) {
    mode = 'blocklist';
  }

  // Build rules from the appropriate option
  const rules =
    mode === 'allowlist'
      ? (networkAllow || []).map(host => ({ host }))
      : mode === 'blocklist'
        ? (networkBlock || []).map(host => ({ host }))
        : [];

  return {
    mode,
    rules,
    allowDns: true,
    allowLocalhost: true,
  };
};

/**
 * Create a task for a specific agent
 */
const createTaskForAgent = async (
  project: ProjectManager,
  projectPath: string,
  selectedAiAgent: string,
  selectedModel: string | undefined,
  options: TaskOptions,
  description: string,
  inputsData: Map<string, string>,
  workflowName: string,
  baseBranch: string,
  git: Git,
  jsonMode: boolean,
  networkConfig?: NetworkConfig,
  source?: {
    type: 'github' | 'manual';
    id?: string;
    url?: string;
    title?: string;
    ref?: Record<string, unknown>;
  },
  contextOptions?: {
    context?: string[];
    contextTrustAuthors?: string;
    contextTrustAllAuthors?: boolean;
  }
): Promise<{
  taskId: number;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  startedAt: string;
  workspace: string;
  branch: string;
  savedTo: string;
  context?: Array<{ name: string; uri: string; description: string }>;
} | null> => {
  const { sourceBranch, targetBranch, fromGithub } = options;

  const processManager = jsonMode
    ? undefined
    : new ProcessManager({ title: `Create new task for ${selectedAiAgent}` });
  processManager?.start();

  // Check agent availability early
  const agentTool = getAIAgentTool(selectedAiAgent);
  await agentTool.checkAgent();

  processManager?.addItem('Create the task workspace');

  // Create task using ProjectManager with raw description (will be updated after expansion)
  const task = project.createTask({
    // Temporary title. We will change it after the expansion.
    title: description,
    description: description,
    inputs: inputsData,
    workflowName: workflowName,
    agent: selectedAiAgent,
    agentModel: selectedModel,
    sourceBranch: sourceBranch,
    networkConfig: networkConfig,
    source: source,
  });

  const taskId = task.id;

  // Setup git worktree and branch (in central ~/.rover/data/projects/<id>/workspaces/)
  const worktreePath = project.getWorkspacePath(taskId);
  const branchName = targetBranch || generateBranchName(taskId);

  try {
    git.createWorktree(worktreePath, branchName, baseBranch);

    // Capture the base commit hash (the commit when the worktree was created)
    const baseCommit = git.getCommitHash('HEAD', { worktreePath });
    if (baseCommit) {
      task.setBaseCommit(baseCommit);
    }

    // Copy user .env development files
    copyEnvironmentFiles(projectPath, worktreePath);

    // Configure sparse checkout to exclude files matching exclude patterns
    const projectConfig = ProjectConfigManager.load(projectPath);
    if (
      projectConfig.excludePatterns &&
      projectConfig.excludePatterns.length > 0
    ) {
      git.setupSparseCheckout(worktreePath, projectConfig.excludePatterns);
    }
  } catch (error) {
    processManager?.failLastItem();
    if (!jsonMode) {
      console.error(colors.red('Error creating git workspace: ' + error));
    }
    return null;
  }

  processManager?.updateLastItem(
    `Create the task workspace | Branch: ${branchName}`
  );
  processManager?.completeLastItem();

  processManager?.addItem('Complete task creation');

  const iterationPath = join(task.iterationsPath(), task.iterations.toString());
  mkdirSync(iterationPath, { recursive: true });

  // Create initial iteration.json with raw description
  const iteration = IterationManager.createInitial(
    iterationPath,
    task.id,
    // Temporary title, we will change after the expansion
    description,
    description
  );

  // Update task with workspace information
  task.setWorkspace(worktreePath, branchName);
  task.markInProgress();

  processManager?.completeLastItem();

  // Fetch context and generate index.md
  let contextEntries: Array<{
    name: string;
    uri: string;
    description: string;
  }> = [];
  let contextContent: string | undefined;

  processManager?.addItem('Fetching context sources');

  try {
    // Register built-in providers
    registerBuiltInProviders();

    const trustedAuthors = contextOptions?.contextTrustAuthors
      ? contextOptions.contextTrustAuthors.split(',').map(s => s.trim())
      : undefined;

    const contextManager = new ContextManager(
      contextOptions?.context ?? [],
      task,
      {
        trustAllAuthors: contextOptions?.contextTrustAllAuthors,
        trustedAuthors,
        cwd: projectPath,
      }
    );

    const entries = await contextManager.fetchAndStore();

    // Store in iteration.json
    iteration.setContext(entries);

    // Generate index.md (no previous artifacts for first iteration)
    const indexContent = generateContextIndex(entries, task.iterations);
    writeFileSync(
      join(contextManager.getContextDir(), 'index.md'),
      indexContent
    );

    // Read context content for AI expansion
    // Skip PRs to avoid huge context.
    const expansionEntries = entries.filter(entry => {
      !(entry.metadata?.type || '').includes('pr');
    });
    const storedContent = contextManager.readStoredContent(expansionEntries);
    if (storedContent) {
      contextContent = storedContent;
    }

    processManager?.updateLastItem(
      `Fetching context sources | ${entries.length} source(s) loaded`
    );
    processManager?.completeLastItem();

    // Store entries for return value and display
    contextEntries = entries.map(entry => ({
      name: entry.name,
      uri: entry.uri,
      description: entry.description,
    }));
  } catch (error) {
    processManager?.failLastItem();
    if (error instanceof ContextFetchError) {
      if (!jsonMode) {
        console.error(colors.red(`Error fetching context: ${error.message}`));
      }
    }
    throw error;
  }

  // AI expansion with context content
  processManager?.addItem(`Expand task information using ${selectedAiAgent}`);

  const expandedTask = await agentTool.expandTask(
    description,
    projectPath,
    contextContent
  );

  if (expandedTask) {
    task.updateTitle(expandedTask.title);
    task.updateDescription(expandedTask.description);
    iteration.updateTitle(expandedTask.title);
    iteration.updateDescription(expandedTask.description);
    processManager?.completeLastItem();
  } else {
    processManager?.failLastItem();
    if (!jsonMode) {
      console.error(
        colors.red(`Failed to expand task description using ${selectedAiAgent}`)
      );
    }
  }

  // Resolve and store the agent image that will be used for this task
  const projectConfig = ProjectConfigManager.load(projectPath);
  const agentImage = resolveAgentImage(projectConfig);
  task.setAgentImage(agentImage);

  // Start sandbox container for task execution
  try {
    const sandbox = await createSandbox(task, processManager, {
      extraArgs: options.sandboxExtraArgs,
      projectPath,
    });
    const containerId = await sandbox.createAndStart();

    updateTaskMetadata(
      project,
      task.id,
      {
        containerId,
        executionStatus: 'running',
        runningAt: new Date().toISOString(),
        sandboxMetadata: process.env.DOCKER_HOST
          ? { dockerHost: process.env.DOCKER_HOST }
          : undefined,
      },
      jsonMode
    );

    processManager?.addItem('Task started in background');
    processManager?.completeLastItem();
    processManager?.finish();
  } catch (err) {
    if (isVerbose()) {
      console.log('ERROR:', err);
    }
    // If Docker execution fails to start, reset task to NEW status
    task.resetToNew();

    processManager?.addItem('Task started in background');
    processManager?.failLastItem();
    processManager?.finish();

    if (!jsonMode) {
      console.warn(
        colors.yellow(
          `Task ${taskId} was created, but reset to 'New' due to an error running the container`
        )
      );
      console.log(
        colors.gray(
          'Use ' + colors.cyan(`rover restart ${taskId}`) + ' to retry it'
        )
      );
    }
  }

  return {
    taskId: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    createdAt: task.createdAt,
    startedAt: task.startedAt || '',
    workspace: task.worktreePath,
    branch: task.branchName,
    savedTo: task.getBasePath(),
    context: contextEntries.length > 0 ? contextEntries : undefined,
  };
};

/**
 * Create and assign a new task to an AI agent for execution.
 *
 * This is the primary command for creating work items in Rover. It expands
 * the task description using AI, sets up an isolated git worktree, creates
 * iteration tracking, and launches a sandboxed container running the specified
 * AI agent. Supports multiple agents working on the same task in parallel,
 * GitHub issue integration, custom workflows, and network filtering.
 *
 * @param initPrompt - Initial task description (prompts if not provided)
 * @param options - Command options
 * @param options.workflow - Workflow name to use (defaults to 'swe')
 * @param options.fromGithub - GitHub issue number to fetch description from
 * @param options.yes - Skip interactive prompts
 * @param options.sourceBranch - Base branch for git worktree creation
 * @param options.targetBranch - Custom name for the task branch
 * @param options.agent - AI agent(s) to use with optional model (e.g., 'claude:opus')
 * @param options.json - Output results in JSON format
 * @param options.sandboxExtraArgs - Extra arguments to pass to the container
 * @param options.networkMode - Network filtering mode for the container
 * @param options.networkAllow - Hosts to allow network access to
 * @param options.networkBlock - Hosts to block network access to
 */
const taskCommand = async (initPrompt?: string, options: TaskOptions = {}) => {
  const telemetry = getTelemetry();
  // Extract options
  let {
    yes,
    json,
    fromGithub,
    includeComments,
    sourceBranch,
    targetBranch,
    agent,
    context,
    contextTrustAuthors,
    contextTrustAllAuthors,
  } = options;

  // Set global JSON mode for tests and backwards compatibility
  if (json !== undefined) {
    setJsonMode(json);
  }

  const workflowName = options.workflow || DEFAULT_WORKFLOW;

  const jsonOutput: TaskTaskOutput = {
    success: false,
  };

  // Deprecation: translate --from-github to --context
  if (fromGithub) {
    if (!json) {
      console.warn(
        colors.yellow(
          'Warning: --from-github is deprecated. Use --context github:issue/<number> instead.'
        )
      );
    }

    // Translate to context URI
    context = context ?? [];
    context.push(`github:issue/${fromGithub}`);

    // Translate --include-comments to --context-trust-all-authors
    if (includeComments) {
      if (!json) {
        console.warn(
          colors.yellow(
            'Warning: --include-comments is deprecated. Use --context-trust-all-authors instead.'
          )
        );
      }
      contextTrustAllAuthors = contextTrustAllAuthors || includeComments;
    }
  }

  // Validate --include-comments requires --from-github
  if (includeComments && !fromGithub) {
    jsonOutput.error =
      '--include-comments requires --from-github to be specified';
    await exitWithError(jsonOutput, {
      tips: [
        'Use ' +
          colors.cyan('rover task --from-github <issue> --include-comments') +
          ' to include issue comments',
      ],
      telemetry: getTelemetry(),
    });
    return;
  }

  // Validate mutual exclusivity of --context-trust-authors and --context-trust-all-authors
  if (contextTrustAuthors && contextTrustAllAuthors) {
    jsonOutput.error =
      '--context-trust-authors and --context-trust-all-authors are mutually exclusive';
    await exitWithError(jsonOutput, { telemetry: getTelemetry() });
    return;
  }

  // Get project context
  let project;
  try {
    project = await requireProjectContext();
  } catch (error) {
    jsonOutput.error =
      error instanceof Error ? error.message : 'Failed to get project context';
    await exitWithError(jsonOutput, {
      tips: [
        'Run ' +
          colors.cyan('rover init') +
          ' or ensure you are in a git repository',
      ],
      telemetry,
    });
    return;
  }

  // Parse agent options with optional model (supports "agent:model" syntax)
  let selectedAgents: ParsedAgent[] = [];

  // Check if --agent option is provided and validate it
  if (agent && agent.length > 0) {
    // Parse and validate all agents using colon syntax
    for (const agentString of agent) {
      try {
        const parsed = parseAgentString(agentString);
        selectedAgents.push(parsed);
      } catch (err) {
        jsonOutput.error =
          err instanceof Error ? err.message : `Invalid agent: ${agentString}`;
        await exitWithError(jsonOutput, { telemetry });
        return;
      }
    }
  } else {
    // Fall back to user settings if no agent specified
    try {
      const defaultAgent = getUserAIAgent();
      selectedAgents = [{ agent: defaultAgent, model: undefined }];
    } catch (_err) {
      if (!json) {
        console.log(
          colors.yellow('⚠ Could not load user settings, defaulting to Claude')
        );
      }
      selectedAgents = [{ agent: AI_AGENT.Claude, model: undefined }];
    }
  }

  // Fill in default models for agents without a specified model
  selectedAgents = selectedAgents.map(({ agent: agentName, model }) => ({
    agent: agentName,
    model: model ?? getUserDefaultModel(agentName),
  }));

  // Validate all agents before proceeding
  for (const { agent: selectedAiAgent } of selectedAgents) {
    const valid = validations(selectedAiAgent);

    if (valid != null) {
      jsonOutput.error = `${selectedAiAgent}: ${valid.error}`;
      await exitWithError(jsonOutput, {
        tips: valid.tips,
        telemetry,
      });
      return;
    }
  }

  // Load the workflow
  let workflow: WorkflowManager;

  try {
    const workflowStore = initWorkflowStore(project.path);
    const loadedWorkflow = workflowStore.getWorkflow(workflowName);

    if (loadedWorkflow) {
      workflow = loadedWorkflow;
    } else {
      jsonOutput.error = `Could no load the '${workflowName}' workflow`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }
  } catch (err) {
    jsonOutput.error = `There was an error loading the '${workflowName}' workflow: ${err}`;
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

  if (workflow == null) {
    jsonOutput.error = `The workflow ${workflow} does not exist`;
    await exitWithError(jsonOutput, { telemetry });
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

  // Task source (populated when --from-github is used)
  let taskSource:
    | {
        type: 'github' | 'manual';
        id?: string;
        url?: string;
        title?: string;
        ref?: Record<string, unknown>;
      }
    | undefined;

  // Validate branch option and check for uncommitted changes
  const git = new Git({ cwd: project.path });
  let baseBranch = sourceBranch;

  if (sourceBranch) {
    // Validate specified branch exists
    if (!git.branchExists(sourceBranch)) {
      jsonOutput.error = `Branch '${sourceBranch}' does not exist`;
      await exitWithError(jsonOutput, { telemetry });
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
    if (fromGithub != null) {
      // Load the inputs from GitHub
      const github = new GitHub({ cwd: project.path });
      const remoteUrl = git.remoteUrl();

      // Extract repo info for storing with the task
      const repoInfo = github.getGitHubRepoInfo(remoteUrl);
      if (repoInfo) {
        const issueNumber = parseInt(fromGithub, 10);
        taskSource = {
          type: 'github',
          id: fromGithub,
          url: `https://github.com/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}`,
          ref: {
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            number: issueNumber,
          },
        };
      }

      try {
        const issueData = await github.fetchIssue(fromGithub, remoteUrl, {
          includeComments,
        });
        if (issueData) {
          // Start with the issue body
          description = issueData.body;

          // Append comments if they were included
          if (
            includeComments &&
            issueData.comments &&
            issueData.comments.length > 0
          ) {
            description += formatCommentsAsMarkdown(issueData.comments);
          }

          inputsData.set('description', description);

          if (!issueData.body || issueData.body.length == 0) {
            jsonOutput.error =
              'The GitHub issue description is empty. Add more details to the issue so the Agent can complete it successfully.';
            await exitWithError(jsonOutput, { telemetry });
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

              const agentTool = getAIAgentTool(selectedAgents[0].agent);
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
                await exitWithError(jsonOutput, { telemetry });
                return;
              }
            }
          }
        } else {
          jsonOutput.error = 'Failed to fetch issue from GitHub';
          await exitWithError(jsonOutput, { telemetry });
          return;
        }
      } catch (err) {
        if (err instanceof GitHubError) {
          jsonOutput.error = `Failed to fetch issue from GitHub: ${err.message}`;
        } else {
          jsonOutput.error = `Failed to fetch issue from GitHub: ${err}`;
        }

        await exitWithError(jsonOutput, { telemetry });
        return;
      }
    } else if (stdinIsAvailable()) {
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
          await exitWithWarn('Task creation cancelled', jsonOutput, {
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
      await exitWithError(jsonOutput, { telemetry });
      return;
    }
  }

  if (description.length > 0) {
    // Build network config from CLI options (if provided)
    const networkConfig = buildNetworkConfig(options);

    // Create tasks for each selected agent
    const createdTasks: Array<{
      taskId: number;
      agent: string;
      title: string;
      description: string;
      status: string;
      createdAt: string;
      startedAt: string;
      workspace: string;
      branch: string;
      savedTo: string;
      context?: Array<{ name: string; uri: string; description: string }>;
    }> = [];
    const failedAgents: string[] = [];

    for (let i = 0; i < selectedAgents.length; i++) {
      const { agent: selectedAiAgent, model: selectedModel } =
        selectedAgents[i];

      // Add progress indication for multiple agents in non-JSON mode
      if (!json && selectedAgents.length > 1) {
        const agentDisplay = formatAgentWithModel(
          selectedAiAgent,
          selectedModel
        );
        console.log(
          colors.gray(
            `\nCreating task ${i + 1} of ${selectedAgents.length} (${agentDisplay})...`
          )
        );
      }

      const taskResult = await createTaskForAgent(
        project,
        project.path,
        selectedAiAgent,
        selectedModel,
        options,
        description,
        inputsData,
        workflowName,
        baseBranch!,
        git,
        json || false,
        networkConfig,
        taskSource,
        {
          context,
          contextTrustAuthors,
          contextTrustAllAuthors,
        }
      );

      if (taskResult) {
        createdTasks.push({ agent: selectedAiAgent, ...taskResult });
      } else {
        failedAgents.push(selectedAiAgent);
      }
    }

    // Track new task event (send only once for all agents)
    const isMultiAgent = selectedAgents.length > 1;
    const agentNames = selectedAgents.map(a => a.agent);
    telemetry?.eventNewTask(
      fromGithub != null ? NewTaskProvider.GITHUB : NewTaskProvider.INPUT,
      workflowName,
      isMultiAgent,
      agentNames
    );

    // Handle results
    if (createdTasks.length === 0) {
      jsonOutput.error = `Failed to create tasks for all agents: ${failedAgents.join(', ')}`;
      await exitWithError(jsonOutput, {
        tips: ['Check your agent configurations and try again'],
        telemetry,
      });
      return;
    }

    // Set jsonOutput to the first created task
    const firstTask = createdTasks[0];
    jsonOutput.taskId = firstTask.taskId;
    jsonOutput.title = firstTask.title;
    jsonOutput.description = firstTask.description;
    jsonOutput.status = firstTask.status;
    jsonOutput.createdAt = firstTask.createdAt;
    jsonOutput.startedAt = firstTask.startedAt;
    jsonOutput.workspace = firstTask.workspace;
    jsonOutput.branch = firstTask.branch;
    jsonOutput.savedTo = firstTask.savedTo;
    jsonOutput.context = firstTask.context;
    jsonOutput.success = true;

    // For multiple agents, include all task information in an array
    if (createdTasks.length > 1) {
      jsonOutput.tasks = createdTasks.map(t => ({
        taskId: t.taskId,
        agent: t.agent,
        title: t.title,
        description: t.description,
        status: t.status,
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        workspace: t.workspace,
        branch: t.branch,
        savedTo: t.savedTo,
      }));
    }

    // Build success message
    let successMessage: string;
    const tips: string[] = [];

    if (createdTasks.length === 1) {
      successMessage = 'Task was created successfully';
      tips.push(
        'Use ' + colors.cyan('rover list') + ' to check the list of tasks'
      );
      tips.push(
        'Use ' +
          colors.cyan(`rover logs -f ${firstTask.taskId}`) +
          ' to watch the task logs'
      );
    } else {
      const taskIds = createdTasks.map(t => t.taskId).join(', ');
      successMessage = `Created ${createdTasks.length} tasks (IDs: ${taskIds})`;

      if (!json) {
        console.log('\n' + colors.bold('Created tasks:'));
        for (const task of createdTasks) {
          console.log(
            `  ${colors.cyan(`Task ${task.taskId}`)} - ${task.agent} - ${task.title}`
          );
        }
      }

      tips.push('Use ' + colors.cyan('rover list') + ' to check all tasks');
      tips.push(
        'Use ' +
          colors.cyan(`rover logs -f <task-id>`) +
          ' to watch a specific task'
      );
    }

    // Report failed agents separately if any
    if (failedAgents.length > 0) {
      if (!json) {
        console.warn(
          colors.yellow(
            `\n⚠ Warning: Failed to create tasks for the following agents: ${failedAgents.join(', ')}`
          )
        );
      }
    }

    await exitWithSuccess(successMessage, jsonOutput, {
      tips,
      telemetry,
    });
  } else {
    jsonOutput.error = `Could not determine the description. Please, provide it.`;
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

  await telemetry?.shutdown();
};

export default {
  name: 'task',
  description: 'Create and assign task to an AI Agent to complete it',
  requireProject: true,
  action: taskCommand,
} satisfies CommandDefinition;
