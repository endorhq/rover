import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import yoctoSpinner from 'yocto-spinner';
import { GeminiAI } from '../utils/gemini.js';
import type { TaskExpansion } from '../types.js';
import { startDockerExecution } from './task.js';

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
    previousContext: { plan?: string, summary?: string, iterationNumber?: number }
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
        
        const expanded = await GeminiAI.expandTask(contextPrompt, process.cwd());
        return expanded;
        
    } catch (error) {
        console.error(colors.red('Error expanding task iteration:'), error);
        return null;
    }
};

export const iterateCommand = async (taskId: string, refinements: string, options: { follow?: boolean } = {}): Promise<void> => {
    const endorPath = join(process.cwd(), '.rover');
    const tasksPath = join(endorPath, 'tasks');
    const taskPath = join(tasksPath, taskId);
    const descriptionPath = join(taskPath, 'description.json');
    
    // Check if task exists
    if (!existsSync(taskPath) || !existsSync(descriptionPath)) {
        console.log(colors.red(`✗ Task '${taskId}' not found`));
        return;
    }
    
    try {
        // Load task data
        const taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));
        
        console.log(colors.bold('\n🔄 Task Iteration\n'));
        console.log(colors.gray('ID: ') + colors.cyan(taskId));
        console.log(colors.gray('Title: ') + colors.white(taskData.title));
        console.log(colors.gray('Current Status: ') + colors.yellow(taskData.status));
        console.log(colors.gray('Current Iterations: ') + colors.cyan(taskData.iterations || 0));
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
        const spinner = yoctoSpinner({ text: 'Expanding task iteration with AI...' }).start();
        
        let expandedTask: TaskExpansion | null = null;
        
        try {
            expandedTask = await expandTaskIteration(taskData, refinements, previousContext);
            
            if (expandedTask) {
                spinner.success('Task iteration expanded!');
            } else {
                spinner.error('Failed to expand task iteration');
                console.log(colors.yellow('\n⚠ AI expansion failed. Using manual iteration approach.'));
                
                // Fallback: create simple iteration based on refinements
                expandedTask = {
                    title: `${taskData.title} - Iteration Refinement`,
                    description: `${taskData.description}\n\nAdditional requirements:\n${refinements}`
                };
            }
        } catch (error) {
            spinner.error('Failed to expand task iteration');
            console.error(colors.red('Error:'), error);
            
            // Fallback approach
            expandedTask = {
                title: `${taskData.title} - Iteration Refinement`,
                description: `${taskData.description}\n\nAdditional requirements:\n${refinements}`
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

        const worktreePath = join(taskPath, 'workspace');
        const branchName = `task-${taskId}`;
        
        // Ensure workspace exists
        if (!existsSync(worktreePath)) {
            console.log(colors.red('✗ No workspace found for this task'));
            console.log(colors.gray('  Run ') + colors.cyan(`rover task ${taskId}`) + colors.gray(' first'));
            return;
        }
        
        // Increment iteration counter to create a NEW iteration
        // This ensures each iterate call creates a new iteration folder
        if (!taskData.iterations) taskData.iterations = 0;
        const newIterationNumber = taskData.iterations + 1;
        
        // Create iteration directory for the NEW iteration
        const iterationPath = join(taskPath, 'iterations', newIterationNumber.toString());
        mkdirSync(iterationPath, { recursive: true });
        
        // Update task data with new iteration info
        taskData.iterations = newIterationNumber;
        taskData.lastIterationAt = new Date().toISOString();
        taskData.status = 'IN_PROGRESS';
        
        // Update task description for this iteration
        taskData.iterationDescription = expandedTask.description;
        taskData.iterationTitle = expandedTask.title;
        
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
        
        // Save updated task data
        writeFileSync(descriptionPath, JSON.stringify(taskData, null, 2));
        
        console.log(colors.bold(`\n🚀 Starting Task Iteration #${newIterationNumber}\n`));
        console.log(colors.gray('Updated Title: ') + colors.cyan(expandedTask.title));
        console.log(colors.gray('Iteration Path: ') + colors.cyan(`/rover/tasks/${taskId}/iterations/${newIterationNumber}/`));
        console.log(colors.gray('Workspace: ') + colors.cyan(worktreePath));
        
        // Start Docker execution for this iteration
        console.log(colors.green('\n✓ Iteration prepared, starting Docker execution...'));
        
        // Create a temporary task description file for this iteration
        const iterationTaskDescriptionPath = join(iterationPath, 'task-description.json');
        const iterationTaskData = {
            id: taskData.id,
            title: expandedTask.title,
            description: expandedTask.description,
            status: 'IN_PROGRESS',
            iterationNumber: newIterationNumber,
            originalTitle: taskData.title,
            originalDescription: taskData.description,
            refinements: refinements,
            createdAt: taskData.createdAt,
            iterationCreatedAt: new Date().toISOString()
        };
        
        writeFileSync(iterationTaskDescriptionPath, JSON.stringify(iterationTaskData, null, 2));
        
        // Start Docker container for task execution
        await startDockerExecution(taskId, iterationTaskData, worktreePath, iterationPath, iterationTaskDescriptionPath, options.follow);
        
    } catch (error) {
        console.error(colors.red('Error creating task iteration:'), error);
    }
};