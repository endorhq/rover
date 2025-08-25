import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { getTelemetry } from '../lib/telemetry.js';
import { showRoverChat } from '../utils/display.js';
import { statusColor } from '../utils/task-status.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { CLIJsonOutput } from '../types.js';
import Git from '../lib/git.js';

const { prompt } = enquirer;

/**
 * Interface for JSON output
 */
interface TaskDeleteOutput extends CLIJsonOutput { };

export const deleteCommand = async (taskId: string, options: { json?: boolean, yes?: boolean } = {}) => {
    const telemetry = getTelemetry();
    const git = new Git();

    const json = options.json === true;
    const skipConfirmation = options.yes === true || json;
    const jsonOutput: TaskDeleteOutput = {
        success: false
    };

    // Convert string taskId to number
    const numericTaskId = parseInt(taskId, 10);
    if (isNaN(numericTaskId)) {
        jsonOutput.error = `Invalid task ID '${taskId}' - must be a number`;
        exitWithError(jsonOutput, json);
        return; // Add explicit return to prevent further execution
    }

    try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);
        const taskPath = join(process.cwd(), '.rover', 'tasks', numericTaskId.toString());

        if (!json) {
            showRoverChat([
                "It's time to cleanup some tasks!"
            ]);

            const colorFunc = statusColor(task.status);

            console.log(colors.white.bold('Task to delete'));
            console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
            console.log(colors.gray('├── Title: ') + colors.white(task.title));
            console.log(colors.gray('└── Status: ') + colorFunc(task.status) + '\n');

            console.log(colors.white('This action will delete the task metadata and workspace (git worktree)'));
        }

        // Confirm deletion
        let confirmDeletion = true;

        if (!skipConfirmation) {
            try {
                const { confirm } = await prompt<{ confirm: boolean }>({
                    type: 'confirm',
                    name: 'confirm',
                    message: 'Are you sure you want to delete this task?',
                    initial: false
                });
                confirmDeletion = confirm;
            } catch (_err) {
                jsonOutput.error = 'Task deletion cancelled';
                exitWithWarn('Task deletion cancelled', jsonOutput, json);
            }
        }

        if (confirmDeletion) {
            // Create backup before deletion
            telemetry?.eventDeleteTask();
            task.delete();
            rmSync(taskPath, { recursive: true, force: true });

            // Prune the git workspace
            const prune = git.pruneWorktree();

            if (!prune) {
                if (!json) {
                    console.log(colors.yellow('⚠ There was an error pruning the git worktrees.'));
                }
            }

            jsonOutput.success = true;
            exitWithSuccess('Task deleted successfully!', jsonOutput, json);
        } else {
            jsonOutput.error = 'Task deletion cancelled';
            exitWithWarn('Task deletion cancelled', jsonOutput, json);
        }

    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            jsonOutput.error = `The task with ID ${numericTaskId} was not found`;
            exitWithError(jsonOutput, json);
        } else {
            jsonOutput.error = `There was an error deleting the task: ${error}`;
            exitWithError(jsonOutput, json);
        }
    } finally {
        await telemetry?.shutdown();
    }
};