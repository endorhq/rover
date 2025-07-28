import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import yoctoSpinner from 'yocto-spinner';

const { prompt } = enquirer;

export const resetCommand = async (taskId: string, options: { force?: boolean } = {}) => {
    const endorPath = join(process.cwd(), '.rover');
    const tasksPath = join(endorPath, 'tasks');
    const taskPath = join(tasksPath, taskId);
    const descriptionPath = join(taskPath, 'description.json');
    const worktreePath = join(taskPath, 'workspace');

    // Check if task exists
    if (!existsSync(taskPath) || !existsSync(descriptionPath)) {
        console.log(colors.red(`✗ Task '${taskId}' not found`));
        return;
    }
    
    try {
        // Load task data
        const taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));
        
        console.log(colors.bold('\n🔄 Reset Task\n'));
        console.log(colors.gray('ID: ') + colors.cyan(taskId));
        console.log(colors.gray('Title: ') + colors.white(taskData.title));
        console.log(colors.gray('Status: ') + colors.yellow(taskData.status));
        
        if (existsSync(worktreePath)) {
            console.log(colors.gray('Workspace: ') + colors.cyan(worktreePath));
        }
        if (taskData.branchName) {
            console.log(colors.gray('Branch: ') + colors.cyan(taskData.branchName));
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
            if (worktreePath) {
                try {
                    execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'pipe' });
                    spinner.text = 'Workspace removed';
                } catch (error) {
                    // If workspace removal fails, try to remove it manually
                    try {
                        rmSync(worktreePath, { recursive: true, force: true });
                        // Remove worktree from git's tracking
                        execSync(`git worktree prune`, { stdio: 'pipe' });
                    } catch (manualError) {
                        console.warn(colors.yellow('Warning: Could not remove workspace directory'));
                    }
                }
            }
            
            // Remove git branch if it exists
            if (taskData.branchName) {
                try {
                    // Check if branch exists
                    execSync(`git show-ref --verify --quiet refs/heads/${taskData.branchName}`, { stdio: 'pipe' });
                    // Delete the branch
                    execSync(`git branch -D "${taskData.branchName}"`, { stdio: 'pipe' });
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
        
        // Reset task metadata to original state
        const resetTaskData = {
            id: taskData.id,
            title: taskData.title,
            description: taskData.description,
            status: 'NEW',
            createdAt: taskData.createdAt // Keep original creation date
        };
        
        // Save reset task data
        writeFileSync(descriptionPath, JSON.stringify(resetTaskData, null, 2));
        
        spinner.success('Task reset successfully');
        
        console.log(colors.green('\n✓ Task has been reset to original state'));
        console.log(colors.gray('  Status: ') + colors.cyan('NEW'));
        console.log(colors.gray('  All execution metadata cleared'));
        console.log(colors.gray('  Workspace and branch removed'));
        
    } catch (error) {
        console.error(colors.red('Error resetting task:'), error);
    }
};