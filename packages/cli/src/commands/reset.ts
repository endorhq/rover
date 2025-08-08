import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import yoctoSpinner from 'yocto-spinner';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';

const { prompt } = enquirer;

export const resetCommand = async (taskId: string, options: { force?: boolean } = {}) => {
    // Convert string taskId to number
    const numericTaskId = parseInt(taskId, 10);
    if (isNaN(numericTaskId)) {
        console.log(colors.red(`✗ Invalid task ID '${taskId}' - must be a number`));
        return;
    }
    
    try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);
        const taskPath = join(process.cwd(), '.rover', 'tasks', numericTaskId.toString());
        
        console.log(colors.bold('\n🔄 Reset Task\n'));
        console.log(colors.gray('ID: ') + colors.cyan(taskId));
        console.log(colors.gray('Title: ') + colors.white(task.title));
        console.log(colors.gray('Status: ') + colors.yellow(task.status));
        
        if (existsSync(task.worktreePath)) {
            console.log(colors.gray('Workspace: ') + colors.cyan(task.worktreePath));
        }
        if (task.branchName) {
            console.log(colors.gray('Branch: ') + colors.cyan(task.branchName));
        }
        
        console.log(colors.red('\nThis will:'));
        console.log(colors.red('  • Reset task status to NEW'));
        console.log(colors.red('  • Remove the git workspace'));
        console.log(colors.red('  • Remove the iterations metadata'));
        console.log(colors.red('  • Delete the git branch'));
        console.log(colors.red('  • Clear all execution metadata'));
        console.log("");
        
        // Confirm reset unless force flag is used
        if (!options.force) {
            const { confirm } = await prompt<{ confirm: boolean }>({
                type: 'confirm',
                name: 'confirm',
                message: 'Are you sure you want to reset this task?',
                initial: false
            });
            
            if (!confirm) {
                console.log(colors.yellow('\n⚠ Task reset cancelled'));
                return;
            }
        }
        
        const spinner = yoctoSpinner({ text: 'Resetting task...' }).start();
        
        try {
            // Check if we're in a git repository
            execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
            
            // Remove git workspace if it exists
            if (task.worktreePath) {
                try {
                    execSync(`git worktree remove "${task.worktreePath}" --force`, { stdio: 'pipe' });
                    spinner.text = 'Workspace removed';
                } catch (error) {
                    // If workspace removal fails, try to remove it manually
                    try {
                        rmSync(task.worktreePath, { recursive: true, force: true });
                        // Remove worktree from git's tracking
                        execSync(`git worktree prune`, { stdio: 'pipe' });
                    } catch (manualError) {
                        console.warn(colors.yellow('Warning: Could not remove workspace directory'));
                    }
                }
            }
            
            // Remove git branch if it exists
            if (task.branchName) {
                try {
                    // Check if branch exists
                    execSync(`git show-ref --verify --quiet refs/heads/${task.branchName}`, { stdio: 'pipe' });
                    // Delete the branch
                    execSync(`git branch -D "${task.branchName}"`, { stdio: 'pipe' });
                    spinner.text = 'Branch removed';
                } catch (error) {
                    // Branch doesn't exist or couldn't be deleted, which is fine
                }
            }
            
        } catch (error) {
            // Not in a git repository, skip git operations
        }

        // Delete the iterations
        const iterationPath = join(taskPath, 'iterations');
        rmSync(iterationPath, { recursive: true, force: true });
        
        // Reset task to original state using existing TaskDescription instance
        task.setStatus('NEW');
        task.setWorkspace('', ''); // Clear workspace information
        
        spinner.success('Task reset successfully');
        
        console.log(colors.green('\n✓ Task has been reset to original state'));
        console.log(colors.gray('  Status: ') + colors.cyan('NEW'));
        console.log(colors.gray('  All execution metadata cleared'));
        console.log(colors.gray('  Workspace and branch removed'));
        
    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            console.log(colors.red(`✗ ${error.message}`));
        } else {
            console.error(colors.red('Error resetting task:'), error);
        }
    }
};