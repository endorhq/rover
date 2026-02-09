import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_AGENT,
  IterationManager,
  ProcessManager,
  showProperties,
  showTitle,
  type TaskDescriptionManager,
  ContextManager,
  generateContextIndex,
  ContextFetchError,
  registerBuiltInProviders,
  type ContextIndexOptions,
} from 'rover-core';
import { TaskNotFoundError } from 'rover-schemas';
import {
  getAIAgentTool,
  getUserAIAgent,
  getUserDefaultModel,
  type AIAgentTool,
} from '../lib/agents/index.js';
import { parseAgentString } from '../utils/agent-parser.js';
import { isJsonMode, requireProjectContext } from '../lib/context.js';
import type { IPromptTask } from '../lib/prompts/index.js';
import { createSandbox } from '../lib/sandbox/index.js';
import { getTelemetry } from '../lib/telemetry.js';
import type { IterateOutput } from '../output-types.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { readFromStdin, stdinIsAvailable } from '../utils/stdin.js';
import type { CommandDefinition } from '../types.js';

const { prompt } = enquirer;

type IterationContext = {
  plan?: string;
  changes?: string;
  iterationNumber?: number;
};

/**
 * Command options
 */
interface IterateOptions {
  json?: boolean;
  interactive?: boolean;
  agent?: string;
  context?: string[];
  contextTrustAuthors?: string;
  contextTrustAllAuthors?: boolean;
}

/**
 * Expand iteration instructions using AI
 */
const expandIterationInstructions = async (
  instructions: string,
  previousContext: IterationContext,
  aiAgent: AIAgentTool,
  jsonMode: boolean,
  contextContent?: string
): Promise<IPromptTask | null> => {
  try {
    const expanded = await aiAgent.expandIterationInstructions(
      instructions,
      previousContext.plan,
      previousContext.changes,
      contextContent
    );
    return expanded;
  } catch (error) {
    if (!jsonMode) {
      console.error(
        colors.red('Error expanding iteration instructions:'),
        error
      );
    }
    return null;
  }
};

/**
 * Add a new iteration to an existing Rover task with additional instructions.
 *
 * Creates a new iteration for a task by providing refinement instructions that
 * build upon the work from previous iterations. The AI agent uses context from
 * previous plans and changes to understand the task state. Supports both batch
 * mode (with instructions) and interactive mode for real-time collaboration.
 *
 * @param taskId - The numeric task ID to iterate on
 * @param instructions - New requirements or refinement instructions to apply
 * @param options - Command options
 * @param options.json - Output results in JSON format
 * @param options.interactive - Open an interactive shell session for iteration
 */
const iterateCommand = async (
  taskId: string,
  instructions?: string,
  options: IterateOptions = {}
): Promise<void> => {
  const telemetry = getTelemetry();
  const result: IterateOutput = {
    success: false,
    taskId: 0,
    taskTitle: '',
    iterationNumber: 0,
    instructions: instructions || '',
  };

  // Convert string taskId to number or fail
  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    result.error = `Invalid task ID '${taskId}' - must be a number`;
    if (isJsonMode()) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(colors.red(`✗ ${result.error}`));
    }
    return;
  }

  result.taskId = numericTaskId;

  // Require project context
  let project;
  try {
    project = await requireProjectContext();
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    exitWithError(result, { telemetry });
    return;
  }

  // Load the task using ProjectManager
  let task: TaskDescriptionManager | undefined;

  try {
    task = project.getTask(numericTaskId);
    if (!task) {
      throw new TaskNotFoundError(numericTaskId);
    }
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      result.error = error.message;
    } else {
      result.error = `Error loading task: ${error}`;
    }

    exitWithError(result, { telemetry });
    return;
  }

  // Ensure workspace exists
  if (!task.worktreePath || !existsSync(task.worktreePath)) {
    result.error = 'No workspace found for this task';
    if (isJsonMode()) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(colors.red('✗ No workspace found for this task'));
      console.log(
        colors.gray('  Run ') +
          colors.cyan(`rover task ${taskId}`) +
          colors.gray(' first')
      );
    }
    return;
  }

  // Ensure the task is not currently running
  if (task.isInProgress() || task.isIterating()) {
    result.error =
      'Cannot iterate over a running task. Please wait it to finish first.';
    exitWithError(result, { telemetry });
    return;
  }

  if (!isJsonMode()) {
    showTitle('Task to iterate');

    const props: Record<string, string> = {
      ID: numericTaskId.toString(),
      Title: task.title,
      Status: task.status,
      Iterations: task.iterations.toString(),
      Description: task.description,
    };

    showProperties(props);
  }

  // For interactive iterations, we split here.
  if (options.interactive) {
    // Read the instructions
    let finalInstructions = instructions?.trim() || '';

    if (!finalInstructions && stdinIsAvailable()) {
      const stdinInput = await readFromStdin();
      if (stdinInput) {
        finalInstructions = stdinInput;
      }
    }

    showTitle('Starting interactive session in sandbox');

    // Start the interactive process
    try {
      // Start sandbox container for task execution
      const sandbox = await createSandbox(task, undefined, {
        projectPath: project.path,
      });
      // TODO: ADD INITIAL PROMPT!
      await sandbox.runInteractive();
    } catch (error) {
      if (error instanceof TaskNotFoundError) {
        result.error = error.message;
      } else if (error instanceof Error) {
        result.error = `Error creating task iteration: ${error.message}`;
      } else {
        result.error = 'Unknown error creating task iteration';
      }

      console.error(colors.red(`✗ ${result.error}`));
    } finally {
      await telemetry?.shutdown();
    }
  } else {
    // Handle missing instructions - try stdin first, then prompt
    let finalInstructions = instructions?.trim() || '';

    if (!isJsonMode()) {
      showTitle('New instructions for iteration');
    }

    if (!finalInstructions) {
      // Try to read from stdin first
      if (stdinIsAvailable()) {
        const stdinInput = await readFromStdin();
        if (stdinInput) {
          finalInstructions = stdinInput;
          if (!isJsonMode()) {
            console.log(colors.gray('(From stdin)'), finalInstructions);
          }
        }
      }

      // If still no instructions and not in JSON mode, prompt user
      if (!finalInstructions) {
        if (isJsonMode()) {
          result.error = 'Instructions are required in JSON mode';
          await exitWithError(result, { telemetry });
          return;
        }

        // Interactive prompt for instructions
        try {
          const { input } = await prompt<{ input: string }>({
            type: 'input',
            name: 'input',
            message: 'Describe the changes you want to apply to this task:',
            validate: value =>
              value.trim().length > 0 ||
              'Please provide refinement instructions',
          });
          finalInstructions = input;
        } catch (_err) {
          await exitWithWarn('Task deletion cancelled', result, {
            telemetry,
          });
          return;
        }
      }
    } else {
      if (!isJsonMode()) {
        console.log(finalInstructions);
      }
    }

    result.instructions = finalInstructions;

    try {
      // Load AI agent selection - prefer CLI flag, then task's agent, then user settings
      let selectedAiAgent: string;
      let selectedModel: string | undefined;

      if (options.agent) {
        const parsed = parseAgentString(options.agent);
        selectedAiAgent = parsed.agent;
        selectedModel = parsed.model ?? getUserDefaultModel(parsed.agent);
        task.setAgent(selectedAiAgent, selectedModel);
      } else if (task.agent) {
        selectedAiAgent = task.agent;
        selectedModel = task.agentModel;
      } else {
        selectedAiAgent = AI_AGENT.Claude;
        try {
          selectedAiAgent = getUserAIAgent();
        } catch (_err) {
          if (!isJsonMode()) {
            console.log(
              colors.yellow(
                '⚠ Could not load user settings, defaulting to Claude'
              )
            );
          }
        }
      }

      // Create AI agent instance
      const aiAgent = getAIAgentTool(selectedAiAgent);

      // Show the process
      const processManager = isJsonMode()
        ? undefined
        : new ProcessManager({ title: 'Create a new iteration for this task' });
      processManager?.start();

      processManager?.addItem('Retrieving context from previous iterations');

      // Get previous iteration context
      const lastIteration = task.getLastIteration();
      const previousContext: IterationContext = {};

      if (lastIteration) {
        const files = lastIteration.getMarkdownFiles(['plan.md', 'changes.md']);

        previousContext.iterationNumber = lastIteration.iteration;

        if (files.has('plan.md')) {
          previousContext.plan = files.get('plan.md');
        }

        if (files.has('changes.md')) {
          previousContext.changes = files.get('changes.md');
        }
      }

      processManager?.completeLastItem();

      result.worktreePath = task.worktreePath;

      processManager?.addItem('Creating the new iteration for the task');

      // Increment iteration counter and update task
      const newIterationNumber = task.iterations + 1;
      result.iterationNumber = newIterationNumber;

      // Track iteration event
      telemetry?.eventIterateTask(newIterationNumber);

      // Create iteration directory for the NEW iteration
      const iterationPath = join(
        task.iterationsPath(),
        newIterationNumber.toString()
      );
      mkdirSync(iterationPath, { recursive: true });
      result.iterationPath = iterationPath;

      // Update task with new iteration info
      task.incrementIteration();
      task.markIterating();

      // Create new iteration config with raw instructions (will be updated after expansion)
      const iteration = IterationManager.createIteration(
        iterationPath,
        newIterationNumber,
        task.id,
        finalInstructions,
        finalInstructions,
        previousContext
      );

      processManager?.completeLastItem();

      // Validate mutual exclusivity of --context-trust-authors and --context-trust-all-authors
      if (options.contextTrustAuthors && options.contextTrustAllAuthors) {
        result.error =
          '--context-trust-authors and --context-trust-all-authors are mutually exclusive';
        exitWithError(result, { telemetry });
        return;
      }

      // Fetch context and collect artifacts from previous iterations
      processManager?.addItem('Fetching context sources');

      let contextContent: string | undefined;

      try {
        // Register built-in providers
        registerBuiltInProviders();

        const trustedAuthors = options.contextTrustAuthors
          ? options.contextTrustAuthors.split(',').map(s => s.trim())
          : undefined;

        const contextManager = new ContextManager(options.context ?? [], task, {
          trustAllAuthors: options.contextTrustAllAuthors,
          trustedAuthors,
          cwd: project.path,
        });

        const entries = await contextManager.fetchAndStore();

        // Store in iteration.json
        iteration.setContext(entries);

        // Gather artifacts from all previous iterations
        const { summaries, plans } =
          task.getPreviousIterationArtifacts(newIterationNumber);

        // Copy plan files into context directory and build references
        const iterationPlans: ContextIndexOptions['iterationPlans'] = [];
        for (const plan of plans) {
          const planFilename = `plan-iter-${plan.iteration}.md`;
          writeFileSync(
            join(contextManager.getContextDir(), planFilename),
            plan.content
          );
          iterationPlans.push({
            iteration: plan.iteration,
            file: planFilename,
          });
        }

        // Generate index.md with artifacts
        const indexContent = generateContextIndex(entries, task.iterations, {
          iterationSummaries: summaries,
          iterationPlans,
        });
        writeFileSync(
          join(contextManager.getContextDir(), 'index.md'),
          indexContent
        );

        // Read context content for AI expansion
        // Skip PRs to avoid huge context.
        const expansionEntries = entries.filter(entry => {
          !(entry.metadata?.type || '').includes('pr');
        });
        const storedContent =
          contextManager.readStoredContent(expansionEntries);
        if (storedContent) {
          contextContent = storedContent;
        }

        processManager?.updateLastItem(
          `Fetching context sources | ${entries.length} source(s) loaded`
        );
        processManager?.completeLastItem();

        // Display context summary
        if (!isJsonMode() && entries.length > 0) {
          console.log(colors.gray('\nContext sources:'));
          for (const entry of entries) {
            console.log(colors.gray(`  - ${entry.name}: ${entry.description}`));
          }
        }
      } catch (error) {
        processManager?.failLastItem();
        if (error instanceof ContextFetchError) {
          if (!isJsonMode()) {
            console.error(
              colors.red(`Error fetching context: ${error.message}`)
            );
          }
        }
        throw error;
      }

      // AI expansion with context content
      processManager?.addItem('Expanding new instructions with AI agent');

      let expandedTask: IPromptTask | null = null;

      try {
        expandedTask = await expandIterationInstructions(
          finalInstructions,
          previousContext,
          aiAgent,
          options.json === true,
          contextContent
        );

        if (expandedTask) {
          processManager?.completeLastItem();
        } else {
          processManager?.failLastItem();
        }
      } catch (error) {
        processManager?.failLastItem();
      }

      if (expandedTask == null) {
        // Fallback approach
        expandedTask = {
          title: `${task.title} - Iteration refinement instructinos`,
          description: `${task.description}\n\nAdditional requirements:\n${finalInstructions}`,
        };
      }

      // Update iteration with expanded values
      iteration.updateTitle(expandedTask.title);
      iteration.updateDescription(expandedTask.description);

      // TODO(angel): Is this required?
      result.expandedTitle = expandedTask.title;
      result.expandedDescription = expandedTask.description;

      // Start sandbox container for task execution
      const sandbox = await createSandbox(task, processManager, {
        projectPath: project.path,
      });
      const containerId = await sandbox.createAndStart();

      // Update task metadata with new container ID for this iteration
      task.setContainerInfo(
        containerId,
        'running',
        process.env.DOCKER_HOST
          ? { dockerHost: process.env.DOCKER_HOST }
          : undefined
      );

      result.success = true;

      processManager?.addItem('New iteration started in background');
      processManager?.completeLastItem();
      processManager?.finish();

      await exitWithSuccess('Iteration started successfully', result, {
        tips: [
          'Use ' +
            colors.cyan(`rover logs -f ${task.id} ${task.iterations}`) +
            ' to watch the task logs',
          'Use ' +
            colors.cyan(`rover inspect ${task.id} ${task.iterations}`) +
            ' to check the task status',
        ],
        telemetry,
      });
    } catch (error) {
      if (error instanceof TaskNotFoundError) {
        result.error = error.message;
      } else if (error instanceof Error) {
        result.error = `Error creating task iteration: ${error.message}`;
      } else {
        result.error = 'Unknown error creating task iteration';
      }

      if (isJsonMode()) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (error instanceof TaskNotFoundError) {
          console.log(colors.red(`✗ ${error.message}`));
        } else {
          console.error(colors.red('Error creating task iteration:'), error);
        }
      }
    } finally {
      await telemetry?.shutdown();
    }
  }
};

export default {
  name: 'iterate',
  description: 'Add instructions to a task and start new iteration',
  requireProject: true,
  action: iterateCommand,
} satisfies CommandDefinition;
