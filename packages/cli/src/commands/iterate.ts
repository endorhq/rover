import enquirer from 'enquirer';
import colors from 'ansi-colors';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProcessManager, showProperties, showTitle } from 'rover-common';
import { createSandbox } from '../lib/sandbox/index.js';
import {
  getAIAgentTool,
  getUserAIAgent,
  type AIAgentTool,
} from '../lib/agents/index.js';
import type { IPromptTask } from '../lib/prompts/index.js';
import { TaskDescriptionManager, TaskNotFoundError } from 'rover-schemas';
import { AI_AGENT } from 'rover-common';
import { IterationManager } from 'rover-schemas';
import { getTelemetry } from '../lib/telemetry.js';
import { readFromStdin, stdinIsAvailable } from '../utils/stdin.js';
import { CLIJsonOutput } from '../types.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { isJsonMode } from '../lib/global-state.js';

const { prompt } = enquirer;

interface IterateResult extends CLIJsonOutput {
  taskId: number;
  taskTitle: string;
  iterationNumber: number;
  expandedTitle?: string;
  expandedDescription?: string;
  instructions: string;
  worktreePath?: string;
  iterationPath?: string;
}

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
}

/**
 * Expand iteration instructions using AI
 */
const expandIterationInstructions = async (
  instructions: string,
  previousContext: IterationContext,
  aiAgent: AIAgentTool,
  jsonMode: boolean
): Promise<IPromptTask | null> => {
  try {
    const expanded = await aiAgent.expandIterationInstructions(
      instructions,
      previousContext.plan,
      previousContext.changes
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
 * Command to iterate over a existing task.
 */
export const iterateCommand = async (
  taskId: string,
  instructions?: string,
  options: IterateOptions = {}
): Promise<void> => {
  const telemetry = getTelemetry();
  const result: IterateResult = {
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

  // Load the task first.
  let task: TaskDescriptionManager;

  try {
    task = TaskDescriptionManager.load(numericTaskId);
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
            value.trim().length > 0 || 'Please provide refinement instructions',
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
    // Load AI agent selection - prefer task's agent or fall back to user settings
    let selectedAiAgent = task.agent || AI_AGENT.Claude; // Use task agent if available

    if (!task.agent) {
      // No agent stored in task, try user settings
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

    processManager?.addItem('Expanding new instructions with AI agent');

    let expandedTask: IPromptTask | null = null;

    try {
      expandedTask = await expandIterationInstructions(
        finalInstructions,
        previousContext,
        aiAgent,
        options.json === true
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

    // TODO(angel): Is this required?
    result.expandedTitle = expandedTask.title;
    result.expandedDescription = expandedTask.description;

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

    // Create new iteration config
    IterationManager.createIteration(
      iterationPath,
      newIterationNumber,
      task.id,
      expandedTask.title,
      expandedTask.description,
      previousContext
    );

    processManager?.completeLastItem();

    // Start sandbox container for task execution
    const sandbox = await createSandbox(task, processManager);
    const containerId = await sandbox.createAndStart();

    // Update task metadata with new container ID for this iteration
    task.setContainerInfo(containerId, 'running');

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
};
