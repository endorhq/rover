import enquirer from 'enquirer';
import colors from 'ansi-colors';
import { existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchSync } from 'rover-common';
import yoctoSpinner from 'yocto-spinner';
import { startDockerExecution } from './task.js';
import {
  getAIAgentTool,
  getUserAIAgent,
  type AIAgentTool,
} from '../lib/agents/index.js';
import type { IPromptTask } from '../lib/prompts/index.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { AI_AGENT } from '../lib/config.js';
import { IterationConfig } from '../lib/iteration.js';
import { getTelemetry } from '../lib/telemetry.js';
import { showRoverChat } from '../utils/display.js';
import { readFromStdin, stdinIsAvailable } from '../utils/stdin.js';
import { CLIJsonOutput } from '../types.js';
import { exitWithError, exitWithWarn } from '../utils/exit.js';
import { fa } from 'zod/locales';

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
 * Get the latest iteration context from previous executions
 */
const getLatestIterationContext = (
  taskPath: string,
  jsonMode: boolean
): IterationContext => {
  const iterationsPath = join(taskPath, 'iterations');

  if (!existsSync(iterationsPath)) {
    return {};
  }

  try {
    // Find the latest iteration directory
    const iterations = readdirSync(iterationsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => parseInt(dirent.name, 10))
      .filter(num => !isNaN(num))
      .sort((a, b) => b - a); // Sort descending to get latest first

    if (iterations.length === 0) {
      return {};
    }

    const latestIteration = iterations[0];
    const latestIterationPath = join(
      iterationsPath,
      latestIteration.toString()
    );

    let plan, changes;

    // Try to read plan.md
    const planPath = join(latestIterationPath, 'plan.md');
    if (existsSync(planPath)) {
      try {
        plan = readFileSync(planPath, 'utf8');
      } catch (error) {
        if (!jsonMode) {
          console.warn(colors.yellow('Warning: Could not read previous plan'));
        }
      }
    }

    // Try to read changes.md
    const changesPath = join(latestIterationPath, 'changes.md');
    if (existsSync(changesPath)) {
      try {
        changes = readFileSync(changesPath, 'utf8');
      } catch (error) {
        if (!jsonMode) {
          console.warn(
            colors.yellow('Warning: Could not read previous changes')
          );
        }
      }
    }

    return { plan, changes, iterationNumber: latestIteration };
  } catch (error) {
    if (!jsonMode) {
      console.warn(colors.yellow('Warning: Could not read iteration context'));
    }
    return {};
  }
};

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

export const iterateCommand = async (
  taskId: string,
  instructions?: string,
  options: { follow?: boolean; json?: boolean } = {}
): Promise<void> => {
  const telemetry = getTelemetry();
  const json = options.json === true;
  const result: IterateResult = {
    success: false,
    taskId: 0,
    taskTitle: '',
    iterationNumber: 0,
    instructions: instructions || '',
  };

  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    result.error = `Invalid task ID '${taskId}' - must be a number`;
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(colors.red(`✗ ${result.error}`));
    }
    return;
  }

  result.taskId = numericTaskId;

  // Handle missing instructions - try stdin first, then prompt
  let finalInstructions = instructions?.trim() || '';

  if (!finalInstructions) {
    // Try to read from stdin first
    if (stdinIsAvailable()) {
      const stdinInput = await readFromStdin();
      if (stdinInput) {
        finalInstructions = stdinInput;
        if (!options.json) {
          console.log(colors.gray('✓ Read instructions from stdin'));
        }
      }
    }

    // If still no instructions and not in JSON mode, prompt user
    if (!finalInstructions) {
      if (json) {
        result.error = 'Instructions are required in JSON mode';
        exitWithError(result, json);
        return;
      }

      // Interactive prompt for instructions
      try {
        const { input } = await prompt<{ input: string }>({
          type: 'input',
          name: 'input',
          message:
            'Describe the refinement instructions or new requirements for this task:',
          validate: value =>
            value.trim().length > 0 || 'Please provide refinement instructions',
        });
        finalInstructions = input;
      } catch (_err) {
        exitWithWarn('Task deletion cancelled', result, json);
        return;
      }
    }
  }

  result.instructions = finalInstructions;

  if (!json) {
    showRoverChat(
      [
        "hey human! Let's iterate over this task.",
        'I got your new instructions and will ask an agent to implement them.',
      ],
      {
        breaklineBefore: false,
      }
    );
  }

  try {
    // Load task using TaskDescription first to get agent preference
    const task = TaskDescription.load(numericTaskId);

    // Load AI agent selection - prefer task's agent, fall back to user settings
    let selectedAiAgent = task.agent || AI_AGENT.Claude; // Use task agent if available

    if (!task.agent) {
      // No agent stored in task, try user settings
      try {
        selectedAiAgent = getUserAIAgent();
      } catch (_err) {
        if (!json) {
          console.log(
            colors.yellow(
              '⚠ Could not load user settings, defaulting to Claude'
            )
          );
        }
      }
    } else {
      if (!options.json) {
        console.log(colors.gray(`Using agent from task: ${selectedAiAgent}`));
      }
    }

    // Create AI agent instance
    const aiAgent = getAIAgentTool(selectedAiAgent);
    const taskPath = join(
      process.cwd(),
      '.rover',
      'tasks',
      numericTaskId.toString()
    );
    result.taskTitle = task.title;

    if (!options.json) {
      console.log(colors.white.bold('Task Details'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Task Title: ') + colors.white(task.title));
      console.log(
        colors.gray('├── Current Status: ') + colors.white(task.status)
      );
      console.log(
        colors.gray('└── Instructions: ') + colors.green(finalInstructions)
      );
    }

    // Get previous iteration context
    const previousContext = getLatestIterationContext(
      taskPath,
      options.json === true
    );

    // Expand task with AI
    if (!options.json) {
      console.log('');
    }

    const spinner = !options.json
      ? yoctoSpinner({
          text: `Expanding task instructions with ${selectedAiAgent.charAt(0).toUpperCase() + selectedAiAgent.slice(1)}...`,
        }).start()
      : null;

    let expandedTask: IPromptTask | null = null;

    try {
      expandedTask = await expandIterationInstructions(
        finalInstructions,
        previousContext,
        aiAgent,
        options.json === true
      );

      if (expandedTask) {
        if (spinner) spinner.success('Task iteration expanded!');
      } else {
        if (spinner) spinner.error('Failed to expand task iteration');
        if (!options.json) {
          console.log(
            colors.yellow(
              '\n⚠ AI expansion failed. Using manual iteration approach.'
            )
          );
        }

        // Fallback: create simple iteration based on instructions
        expandedTask = {
          title: `${task.title} - Iteration refinement instructions`,
          description: `${task.description}\n\nAdditional requirements:\n${finalInstructions}`,
        };
      }
    } catch (error) {
      if (spinner)
        spinner.error(
          'Failed to expand iteration instructions. Continuing with original values'
        );

      // Fallback approach
      expandedTask = {
        title: `${task.title} - Iteration refinement instructinos`,
        description: `${task.description}\n\nAdditional requirements:\n${finalInstructions}`,
      };
    }

    if (!options.json) {
      console.log('');
    }

    if (!expandedTask) {
      result.error = 'Could not create iteration';
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(colors.red('✗ Could not create iteration'));
      }
      return;
    }

    result.expandedTitle = expandedTask.title;
    result.expandedDescription = expandedTask.description;

    // Skip confirmation and refinement instructions if --json flag is passed
    if (!options.json) {
      // Display the expanded iteration
      console.log(colors.white.bold('Iteration:'));
      console.log(
        colors.gray('├── Instructions: ') + colors.cyan(expandedTask.title)
      );
      console.log(
        colors.gray('└── Details: ') + colors.white(expandedTask.description)
      );
    }

    // Check if we're in a git repository and setup worktree
    try {
      launchSync('git', ['rev-parse', '--is-inside-work-tree']);
    } catch (error) {
      result.error = 'Not in a git repository';
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(colors.red('✗ Not in a git repository'));
        console.log(colors.gray('  Git worktree required for task iteration'));
      }
      return;
    }

    // Ensure workspace exists
    if (!task.worktreePath || !existsSync(task.worktreePath)) {
      result.error = 'No workspace found for this task';
      if (options.json) {
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

    result.worktreePath = task.worktreePath;

    // Increment iteration counter and update task
    const newIterationNumber = task.iterations + 1;
    result.iterationNumber = newIterationNumber;

    // Track iteration event
    telemetry?.eventIterateTask(newIterationNumber);

    // Create iteration directory for the NEW iteration
    const iterationPath = join(
      taskPath,
      'iterations',
      newIterationNumber.toString()
    );
    mkdirSync(iterationPath, { recursive: true });
    result.iterationPath = iterationPath;

    // Update task with new iteration info
    task.incrementIteration();
    task.markIterating();

    // Create new iteration config
    IterationConfig.createIteration(
      iterationPath,
      newIterationNumber,
      task.id,
      expandedTask.title,
      expandedTask.description,
      previousContext
    );

    // Start Docker container for task execution
    await startDockerExecution(
      numericTaskId,
      task,
      task.worktreePath,
      iterationPath,
      selectedAiAgent,
      options.follow,
      options.json
    );

    result.success = true;
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      result.error = error.message;
    } else if (error instanceof Error) {
      result.error = `Error creating task iteration: ${error.message}`;
    } else {
      result.error = 'Unknown error creating task iteration';
    }

    if (options.json) {
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
