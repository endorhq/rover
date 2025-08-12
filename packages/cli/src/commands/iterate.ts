import colors from 'ansi-colors';
import { existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import yoctoSpinner from 'yocto-spinner';
import type { TaskExpansion, AIProvider } from '../types.js';
import { startDockerExecution } from './task.js';
import { createAIProvider } from '../utils/ai-factory.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { UserSettings, AI_AGENT } from '../lib/config.js';
import { IterationConfig } from '../lib/iteration.js';

interface IterateResult {
    success: boolean;
    taskId: number;
    taskTitle: string;
    iterationNumber: number;
    expandedTitle?: string;
    expandedDescription?: string;
    refinements: string;
    worktreePath?: string;
    iterationPath?: string;
    error?: string;
}

type IterationContext = {
    plan?: string;
    changes?: string;
    iterationNumber?: number;
}

/**
 * Get the latest iteration context from previous executions
 */
const getLatestIterationContext = (taskPath: string, jsonMode: boolean): IterationContext => {
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
        const latestIterationPath = join(iterationsPath, latestIteration.toString());

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
                    console.warn(colors.yellow('Warning: Could not read previous changes'));
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
    refinements: string,
    previousContext: IterationContext,
    aiProvider: AIProvider,
    jsonMode: boolean
): Promise<TaskExpansion | null> => {
    try {
        const expanded = await aiProvider.expandIterationInstructions(
            refinements,
            previousContext.plan,
            previousContext.changes
        );
        return expanded;

    } catch (error) {
        if (!jsonMode) {
            console.error(colors.red('Error expanding iteration instructions:'), error);
        }
        return null;
    }
};

export const iterateCommand = async (taskId: string, refinements: string, options: { follow?: boolean; json?: boolean } = {}): Promise<void> => {
    const result: IterateResult = {
        success: false,
        taskId: 0,
        taskTitle: '',
        iterationNumber: 0,
        refinements: refinements
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

    if (!options.json) {
        console.log(`\n🤖 ${colors.green("Rover")}:`, "hey human! Let's iterate over this task");
        console.log(`🤖 ${colors.green("Rover")}:`, 'I got your new instructions and will ask an agent to implement them\n');
    }

    // Load AI agent selection from user settings
    let selectedAiAgent = 'claude'; // default

    try {
        if (UserSettings.exists()) {
            const userSettings = UserSettings.load();
            selectedAiAgent = userSettings.defaultAiAgent || AI_AGENT.Claude;
        } else {
            if (!options.json) {
                console.log(colors.yellow('⚠ User settings not found, defaulting to Claude'));
                console.log(colors.gray('  Run `rover init` to configure AI agent preferences'));
            }
        }
    } catch (error) {
        if (!options.json) {
            console.log(colors.yellow('⚠ Could not load user settings, defaulting to Claude'));
        }
        selectedAiAgent = AI_AGENT.Claude;
    }

    // Create AI provider instance
    const aiProvider = createAIProvider(selectedAiAgent);

    try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);
        const taskPath = join(process.cwd(), '.rover', 'tasks', numericTaskId.toString());
        result.taskTitle = task.title;

        if (!options.json) {
            console.log(colors.white.bold('Task Details'));
            console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
            console.log(colors.gray('├── Task Title: ') + colors.white(task.title));
            console.log(colors.gray('├── Current Status: ') + colors.white(task.status));
            console.log(colors.gray('└── Instructions: ') + colors.green(refinements));
        }

        // Get previous iteration context
        const previousContext = getLatestIterationContext(taskPath, options.json === true);

        // Expand task with AI
        if (!options.json) {
            console.log('');
        }

        const spinner = !options.json ? yoctoSpinner({ text: `Expanding task instructions with ${selectedAiAgent.charAt(0).toUpperCase() + selectedAiAgent.slice(1)}...` }).start() : null;

        let expandedTask: TaskExpansion | null = null;

        try {
            expandedTask = await expandIterationInstructions(refinements, previousContext, aiProvider, options.json === true);

            if (expandedTask) {
                if (spinner) spinner.success('Task iteration expanded!');
            } else {
                if (spinner) spinner.error('Failed to expand task iteration');
                if (!options.json) {
                    console.log(colors.yellow('\n⚠ AI expansion failed. Using manual iteration approach.'));
                }

                // Fallback: create simple iteration based on refinements
                expandedTask = {
                    title: `${task.title} - Iteration Refinement`,
                    description: `${task.description}\n\nAdditional requirements:\n${refinements}`
                };
            }
        } catch (error) {
            if (spinner) spinner.error('Failed to expand task iteration');
            if (!options.json) {
                console.error(colors.red('Error:'), error);
            }

            // Fallback approach
            expandedTask = {
                title: `${task.title} - Iteration Refinement`,
                description: `${task.description}\n\nAdditional requirements:\n${refinements}`
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

        // Skip confirmation and refinements if --json flag is passed
        if (!options.json) {
            // Display the expanded iteration
            console.log(colors.white.bold('Iteration:'));
            console.log(colors.gray('├── Instructions: ') + colors.cyan(expandedTask.title));
            console.log(colors.gray('└── Details: ') + colors.white(expandedTask.description));
        }

        // Check if we're in a git repository and setup worktree
        try {
            execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
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
                console.log(colors.gray('  Run ') + colors.cyan(`rover task ${taskId}`) + colors.gray(' first'));
            }
            return;
        }

        result.worktreePath = task.worktreePath;

        // Increment iteration counter and update task
        const newIterationNumber = task.iterations + 1;
        result.iterationNumber = newIterationNumber;

        // Create iteration directory for the NEW iteration
        const iterationPath = join(taskPath, 'iterations', newIterationNumber.toString());
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
        await startDockerExecution(numericTaskId, task, task.worktreePath, iterationPath, selectedAiAgent, options.follow, options.json);

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
    }
};