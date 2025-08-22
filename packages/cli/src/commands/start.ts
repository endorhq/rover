import colors from 'ansi-colors';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { spawnSync } from '../lib/os.js';
import { generateBranchName } from '../utils/branch-name.js';
import { IterationConfig } from '../lib/iteration.js';
import { startDockerExecution } from './task.js';
import { UserSettings, AI_AGENT } from '../lib/config.js';
import { getTelemetry } from '../lib/telemetry.js';
import yoctoSpinner from 'yocto-spinner';

/**
 * Start a task that is in NEW status
 */
export const startCommand = async (taskId: string, options: { follow?: boolean, json?: boolean, debug?: boolean } = {}) => {
    const telemetry = getTelemetry();
    
    // Convert string taskId to number
    const numericTaskId = parseInt(taskId, 10);
    if (isNaN(numericTaskId)) {
        if (!options.json) {
            console.log(colors.red(`✗ Invalid task ID '${taskId}' - must be a number`));
        }
        return;
    }

    try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);

        // Check if task is in NEW status
        if (!task.isNew()) {
            if (!options.json) {
                console.log(colors.red(`✗ Task ${taskId} is not in NEW status (current: ${task.status})`));
                console.log(colors.gray('  Only tasks in NEW status can be started using this command'));
                console.log(colors.gray('  Use ') + colors.cyan(`rover task "${task.title}"`) + colors.gray(' to create a new task'));
            }
            return;
        }

        // Load AI agent selection from user settings
        let selectedAiAgent = AI_AGENT.Claude; // default

        try {
            if (UserSettings.exists()) {
                const userSettings = UserSettings.load();
                selectedAiAgent = userSettings.defaultAiAgent || AI_AGENT.Claude;
            }
        } catch (error) {
            if (!options.json) {
                console.log(colors.yellow('⚠ Could not load user settings, defaulting to Claude'));
            }
            selectedAiAgent = AI_AGENT.Claude;
        }

        if (!options.json) {
            console.log(colors.bold.white('\n🚀 Starting Task'));
            console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
            console.log(colors.gray('├── Title: ') + colors.white(task.title));
            console.log(colors.gray('└── Status: ') + colors.yellow(task.status));
        }

        const taskPath = join(process.cwd(), '.rover', 'tasks', numericTaskId.toString());

        // Setup git worktree and branch if not already set
        let worktreePath = task.worktreePath;
        let branchName = task.branchName;

        if (!worktreePath || !branchName) {
            worktreePath = join(taskPath, 'workspace');
            branchName = generateBranchName(numericTaskId);

            const spinner = !options.json ? yoctoSpinner({ text: 'Setting up workspace...' }).start() : null;

            try {
                // Check if branch already exists
                let branchExists = false;
                try {
                    spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], { stdio: 'pipe' });
                    branchExists = true;
                } catch (error) {
                    // Branch doesn't exist, which is fine for new worktree
                }

                if (branchExists) {
                    // Create worktree from existing branch
                    spawnSync('git', ['worktree', 'add', worktreePath, branchName], { stdio: 'pipe' });
                } else {
                    // Create new worktree with a new branch
                    spawnSync('git', ['worktree', 'add', worktreePath, '-b', branchName], { stdio: 'pipe' });
                }

                // Update task with workspace information
                task.setWorkspace(worktreePath, branchName);

                if (spinner) spinner.success('Workspace setup complete');
            } catch (error) {
                if (spinner) spinner.error('Failed to setup workspace');
                if (!options.json) {
                    console.error(colors.red('Error creating git workspace:'), error);
                }
                // Mark task back to NEW status due to setup failure
                task.resetToNew();
                return;
            }
        }

        // Ensure iterations directory exists
        const iterationPath = join(taskPath, 'iterations', task.iterations.toString());
        mkdirSync(iterationPath, { recursive: true });

        // Create initial iteration.json if it doesn't exist
        const iterationJsonPath = join(iterationPath, 'iteration.json');
        if (!existsSync(iterationJsonPath)) {
            IterationConfig.createInitial(iterationPath, task.id, task.title, task.description);
        }

        // Mark task as in progress
        task.markInProgress();

        if (!options.json) {
            console.log(colors.gray('└── Workspace: ') + colors.cyan(worktreePath));
            console.log(colors.gray('└── Branch: ') + colors.cyan(branchName));
        }

        // Start Docker container for task execution
        try {
            await startDockerExecution(
                numericTaskId, 
                task, 
                worktreePath, 
                iterationPath, 
                selectedAiAgent, 
                options.follow, 
                options.json, 
                options.debug
            );
        } catch (error) {
            // If Docker execution fails, reset task back to NEW status
            task.resetToNew();
            throw error;
        }

        if (options.json) {
            // Output final JSON after all operations are complete
            const finalJsonOutput = {
                success: true,
                taskId: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                startedAt: task.startedAt,
                workspace: task.worktreePath,
                branch: task.branchName
            };
            console.log(JSON.stringify(finalJsonOutput, null, 2));
        }

    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            if (!options.json) {
                console.log(colors.red(`✗ ${error.message}`));
            }
        } else {
            if (!options.json) {
                console.error(colors.red('Error starting task:'), error);
            }
        }
    } finally {
        await telemetry?.shutdown();
    }
};