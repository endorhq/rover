import colors from 'ansi-colors';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import yoctoSpinner from 'yocto-spinner';
import { formatTaskStatus } from '../../utils/task-status.js';

/**
 * Start an interactive Docker container shell for testing task changes
 */
export const shellTask = async (taskId: string) => {
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
        
        console.log(colors.bold('\n🐚 Task Shell\n'));
        console.log(colors.gray('ID: ') + colors.cyan(taskId));
        console.log(colors.gray('Title: ') + colors.white(taskData.title));
        console.log(colors.gray('Status: ') + colors.yellow(formatTaskStatus(taskData.status)));
        
        // Check if task is already merged/completed
        if (taskData.status === 'COMPLETED') {
            console.log('');
            console.log(colors.yellow(`⚠ This task is already ${formatTaskStatus('COMPLETED').toLowerCase()}`));
            console.log(colors.gray('  The shell will show the final state of the task'));
        }
        
        // Check if worktree exists
        const worktreePath = taskData.worktreePath;
        if (!worktreePath || !existsSync(worktreePath)) {
            console.log('');
            console.log(colors.red('✗ No worktree found for this task'));
            console.log(colors.gray('  Run ') + colors.cyan(`rover tasks start ${taskId}`) + colors.gray(' first to create a workspace'));
            return;
        }
        
        console.log(colors.gray('Worktree: ') + colors.cyan(worktreePath));
        console.log(colors.gray('Branch: ') + colors.cyan(taskData.branchName || `task-${taskId}`));
        
        // Check if Docker is available
        try {
            execSync('docker --version', { stdio: 'pipe' });
        } catch (error) {
            console.log('');
            console.log(colors.red('✗ Docker is not available'));
            console.log(colors.gray('  Please install Docker to use the interactive shell'));
            return;
        }
        
        // Check if we're in a git repository
        try {
            execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
        } catch (error) {
            console.log('');
            console.log(colors.red('✗ Not in a git repository'));
            return;
        }
        
        console.log('');
        console.log(colors.green('✓ Starting interactive shell for task testing'));
        console.log('');
        console.log(colors.cyan('📋 In the shell you can:'));
        console.log(colors.gray('  • Test your changes by running the application'));
        console.log(colors.gray('  • Run tests and verify functionality'));
        console.log(colors.gray('  • Install additional packages if needed'));
        console.log(colors.gray('  • Make temporary modifications for testing'));
        console.log('');
        console.log(colors.yellow('⚠ Note: Changes made in the shell are temporary'));
        console.log(colors.gray('  To persist changes, exit the shell and commit them in the worktree'));
        console.log('');
        console.log(colors.magenta('💡 Type "exit" to leave the shell'));
        console.log('');

        const spinner = yoctoSpinner({ text: 'Starting Docker shell...' }).start();
        
        try {
            const containerName = `rover-shell-${taskId}`;
            
            // Clean up any existing container with same name
            try {
                execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' });
            } catch (error) {
                // Container doesn't exist, which is fine
            }
            
            // Build Docker run command for interactive shell
            const dockerArgs = [
                'run',
                '--rm', // Remove container when it exits
                '-it', // Interactive with TTY
                '--name', containerName,
                '-v', `${worktreePath}:/workspace:rw`,
                '-w', '/workspace',
                '--user', `${process.getuid?.() || 1000}:${process.getgid?.() || 1000}`, // Use current user's UID/GID
                'node:24-alpine',
                '/bin/sh'
            ];
            
            spinner.success('Shell started');
            console.log(colors.cyan('🚀 Starting interactive shell in Docker container...'));
            console.log(colors.gray(`   Working directory: /workspace`));
            console.log(colors.gray(`   Container: ${containerName}`));
            console.log('');
            
            // Start Docker container with direct stdio inheritance for true interactivity
            const dockerProcess = spawn('docker', dockerArgs, {
                stdio: 'inherit' // This gives full control to the user
            });
            
            // Handle process completion
            dockerProcess.on('close', (code) => {
                console.log('');
                if (code === 0) {
                    console.log(colors.green('✓ Shell session ended'));
                } else {
                    console.log(colors.yellow(`⚠ Shell session ended with code ${code}`));
                }
                console.log('');
                console.log(colors.cyan('💡 Your worktree is preserved at: ') + colors.white(worktreePath));
                console.log(colors.gray('   Use ') + colors.cyan(`rover tasks diff ${taskId}`) + colors.gray(' to see any changes you made'));
                console.log(colors.gray('   Use ') + colors.cyan(`rover tasks merge ${taskId}`) + colors.gray(' to merge when ready'));
            });

            dockerProcess.on('error', (error) => {
                console.log('');
                console.error(colors.red('Error running Docker shell:'), error);
            });
            
            // Handle process interruption (Ctrl+C)
            process.on('SIGINT', () => {
                console.log(colors.yellow('\n\n⚠ Stopping shell session...'));
                try {
                    execSync(`docker stop ${containerName}`, { stdio: 'pipe' });
                    console.log(colors.green('✓ Container stopped'));
                } catch (error) {
                    console.log(colors.red('✗ Failed to stop container'));
                }
                process.exit(0);
            });
            
        } catch (error) {
            spinner.error('Failed to start shell');
            console.error(colors.red('Error starting Docker shell:'), error);
        }
        
    } catch (error) {
        console.error(colors.red('Error opening task shell:'), error);
    }
};