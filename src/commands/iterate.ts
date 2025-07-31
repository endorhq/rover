import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import yoctoSpinner from 'yocto-spinner';
import type { TaskExpansion, AIProvider } from '../types.js';
import { startDockerExecution } from './task.js';
import { createAIProvider } from '../utils/ai-factory.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';

const { prompt } = enquirer;

/**
 * Get the latest iteration context from previous executions
 */
const getLatestIterationContext = (taskPath: string): { plan?: string, summary?: string, iterationNumber?: number } => {
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

        let plan, summary;

        // Try to read plan.md
        const planPath = join(latestIterationPath, 'plan.md');
        if (existsSync(planPath)) {
            try {
                plan = readFileSync(planPath, 'utf8');
            } catch (error) {
                console.warn(colors.yellow('Warning: Could not read previous plan'));
            }
        }

        // Try to read summary.md
        const summaryPath = join(latestIterationPath, 'summary.md');
        if (existsSync(summaryPath)) {
            try {
                summary = readFileSync(summaryPath, 'utf8');
            } catch (error) {
                console.warn(colors.yellow('Warning: Could not read previous summary'));
            }
        }

        return { plan, summary, iterationNumber: latestIteration };

    } catch (error) {
        console.warn(colors.yellow('Warning: Could not read iteration context'));
        return {};
    }
};

/**
 * Expand task with iteration refinements using AI
 */
const expandTaskIteration = async (
    originalTask: any,
    refinements: string,
    previousContext: { plan?: string, summary?: string, iterationNumber?: number },
    aiProvider: AIProvider
): Promise<TaskExpansion | null> => {
    try {
        // Build context prompt for AI
        let contextPrompt = `Original Task: "${originalTask.title}"\nDescription: ${originalTask.description}\n\n`;

        if (previousContext.iterationNumber) {
            contextPrompt += `Previous iteration (#${previousContext.iterationNumber}) context:\n\n`;

            if (previousContext.plan) {
                contextPrompt += `Previous Plan:\n${previousContext.plan}\n\n`;
            }

            if (previousContext.summary) {
                contextPrompt += `Previous Summary:\n${previousContext.summary}\n\n`;
            }
        }

        contextPrompt += `New requirements/refinements to incorporate:\n${refinements}\n\n`;
        contextPrompt += `Please create an updated task that incorporates these refinements while building on previous work.`;

        const expanded = await aiProvider.expandTask(contextPrompt, process.cwd());
        return expanded;

    } catch (error) {
        console.error(colors.red('Error expanding task iteration:'), error);
        return null;
    }
};

export const iterateCommand = async (taskId: string, refinements: string, options: { follow?: boolean } = {}): Promise<void> => {
    // Convert string taskId to number
    const numericTaskId = parseInt(taskId, 10);
    if (isNaN(numericTaskId)) {
        console.log(colors.red(`✗ Invalid task ID '${taskId}' - must be a number`));
        return;
    }

    // Load rover configuration to get selected AI agent
    const roverConfigPath = join(process.cwd(), 'rover.json');
    let selectedAiAgent = 'claude'; // default

    try {
        if (existsSync(roverConfigPath)) {
            const config = JSON.parse(readFileSync(roverConfigPath, 'utf-8'));
            selectedAiAgent = config.environment?.selectedAiAgent || 'claude';
        }
    } catch (error) {
        console.log(colors.yellow('⚠ Could not load rover configuration, defaulting to Claude'));
    }

    // Create AI provider instance
    const aiProvider = createAIProvider(selectedAiAgent);

    try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);
        const taskPath = join(process.cwd(), '.rover', 'tasks', numericTaskId.toString());
        console.log(colors.bold('\n🔄 Task Iteration\n'));
        console.log(colors.gray('ID: ') + colors.cyan(task.id.toString()));
        console.log(colors.gray('Title: ') + colors.white(task.title));
        console.log(colors.gray('Current Status: ') + colors.yellow(task.status));
        console.log(colors.gray('Current Iterations: ') + colors.cyan(task.iterations.toString()));
        console.log(colors.gray('Refinements: ') + colors.white(refinements));

        // Get previous iteration context
        console.log(colors.gray('\n📖 Loading previous iteration context...'));
        const previousContext = getLatestIterationContext(taskPath);

        if (previousContext.iterationNumber) {
            console.log(colors.gray('Found previous iteration: ') + colors.cyan(`#${previousContext.iterationNumber}`));
            if (previousContext.plan) console.log(colors.gray('✓ Previous plan loaded'));
            if (previousContext.summary) console.log(colors.gray('✓ Previous summary loaded'));
        } else {
            console.log(colors.gray('No previous iterations found, using original task only'));
        }

        // Expand task with AI
        const spinner = yoctoSpinner({ text: `Expanding task iteration with ${selectedAiAgent.charAt(0).toUpperCase() + selectedAiAgent.slice(1)}...` }).start();

        let expandedTask: TaskExpansion | null = null;

        try {
            expandedTask = await expandTaskIteration(task.toJSON(), refinements, previousContext, aiProvider);

            if (expandedTask) {
                spinner.success('Task iteration expanded!');
            } else {
                spinner.error('Failed to expand task iteration');
                console.log(colors.yellow('\n⚠ AI expansion failed. Using manual iteration approach.'));

                // Fallback: create simple iteration based on refinements
                expandedTask = {
                    title: `${task.title} - Iteration Refinement`,
                    description: `${task.description}\n\nAdditional requirements:\n${refinements}`
                };
            }
        } catch (error) {
            spinner.error('Failed to expand task iteration');
            console.error(colors.red('Error:'), error);

            // Fallback approach
            expandedTask = {
                title: `${task.title} - Iteration Refinement`,
                description: `${task.description}\n\nAdditional requirements:\n${refinements}`
            };
        }

        if (!expandedTask) {
            console.log(colors.red('✗ Could not create iteration'));
            return;
        }

        // Display the expanded iteration
        console.log('\n' + colors.bold('Updated Task for Iteration:'));
        console.log(colors.gray('Title: ') + colors.cyan(expandedTask.title));
        console.log(colors.gray('Description: ') + colors.white(expandedTask.description));

        // Ask for confirmation
        const { confirm } = await prompt<{ confirm: string }>({
            type: 'select',
            name: 'confirm',
            message: '\nProceed with this iteration?',
            choices: [
                { name: 'yes', message: 'Yes, start iteration!' },
                { name: 'refine', message: 'No, let me add more details' },
                { name: 'cancel', message: 'Cancel iteration' }
            ]
        });

        if (confirm === 'cancel') {
            console.log(colors.yellow('\n⚠ Task iteration cancelled'));
            return;
        }

        if (confirm === 'refine') {
            const { additionalInfo } = await prompt<{ additionalInfo: string }>({
                type: 'input',
                name: 'additionalInfo',
                message: 'Provide additional refinements:',
                validate: (value) => value.trim().length > 0 || 'Please provide additional information'
            });

            // Recursively call with additional refinements
            const combinedRefinements = `${refinements}\n\nAdditional refinements: ${additionalInfo}`;
            return iterateCommand(taskId, combinedRefinements);
        }

        // Check if we're in a git repository and setup worktree
        try {
            execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
        } catch (error) {
            console.log(colors.red('✗ Not in a git repository'));
            console.log(colors.gray('  Git worktree required for task iteration'));
            return;
        }

        // Ensure workspace exists
        if (!task.worktreePath || !existsSync(task.worktreePath)) {
            console.log(colors.red('✗ No workspace found for this task'));
            console.log(colors.gray('  Run ') + colors.cyan(`rover task ${taskId}`) + colors.gray(' first'));
            return;
        }

        // Increment iteration counter and update task
        const newIterationNumber = task.iterations + 1;

        // Create iteration directory for the NEW iteration
        const iterationPath = join(taskPath, 'iterations', newIterationNumber.toString());
        mkdirSync(iterationPath, { recursive: true });

        // Update task with new iteration info
        task.incrementIteration();
        task.updateIteration({
            title: expandedTask.title,
            description: expandedTask.description,
            timestamp: new Date().toISOString()
        });
        task.markIterating();

        // Save iteration metadata
        const iterationMetadata = {
            iterationNumber: newIterationNumber,
            refinements: refinements,
            expandedTitle: expandedTask.title,
            expandedDescription: expandedTask.description,
            createdAt: new Date().toISOString(),
            previousContext: previousContext
        };

        writeFileSync(
            join(iterationPath, 'iteration-metadata.json'),
            JSON.stringify(iterationMetadata, null, 2)
        );

        // Task data is automatically saved by TaskDescription methods

        console.log(colors.bold(`\n🚀 Starting Task Iteration #${newIterationNumber}\n`));
        console.log(colors.gray('Updated Title: ') + colors.cyan(expandedTask.title));
        console.log(colors.gray('Iteration Path: ') + colors.cyan(`/rover/tasks/${numericTaskId}/iterations/${newIterationNumber}/`));
        console.log(colors.gray('Workspace: ') + colors.cyan(task.worktreePath));

        // Start Docker execution for this iteration
        console.log(colors.green('\n✓ Iteration prepared, starting Docker execution...'));

        // Create a temporary task description file for this iteration
        const iterationTaskDescriptionPath = join(iterationPath, 'task-description.json');
        const iterationTaskData = {
            id: task.id,
            title: expandedTask.title,
            description: expandedTask.description,
            status: 'ITERATING',
            iterationNumber: newIterationNumber,
            originalTitle: task.title,
            originalDescription: task.description,
            refinements: refinements,
            createdAt: task.createdAt,
            iterationCreatedAt: new Date().toISOString()
        };

        writeFileSync(iterationTaskDescriptionPath, JSON.stringify(iterationTaskData, null, 2));

        // Start Docker container for task execution
        await startDockerExecution(numericTaskId, iterationTaskData, task.worktreePath, iterationPath, selectedAiAgent, iterationTaskDescriptionPath, options.follow);

    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            console.log(colors.red(`✗ ${error.message}`));
        } else {
            console.error(colors.red('Error creating task iteration:'), error);
        }
    }
};