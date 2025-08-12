import colors from 'ansi-colors';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { spawnSync } from '../lib/os.js';
import yoctoSpinner from 'yocto-spinner';
import { formatTaskStatus } from '../utils/task-status.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { getTelemetry } from '../lib/telemetry.js';

/**
 * Start an interactive shell for testing task changes
 */
export const shellCommand = async (taskId: string, options: { container?: boolean }) => {
    const telemetry = getTelemetry();
    // Convert string taskId to number
    const numericTaskId = parseInt(taskId, 10);
    if (isNaN(numericTaskId)) {
        console.log(colors.red(`✗ Invalid task ID '${taskId}' - must be a number`));
        return;
    }

    try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);

        console.log(colors.bold('\n🐚 Task Shell\n'));
        console.log(colors.gray('ID: ') + colors.cyan(task.id.toString()));
        console.log(colors.gray('Title: ') + colors.white(task.title));
        console.log(colors.gray('Status: ') + colors.yellow(formatTaskStatus(task.status)));

        // Check if task is already merged/completed
        if (task.status === 'COMPLETED') {
            console.log('');
            console.log(colors.yellow(`⚠ This task is already ${formatTaskStatus('COMPLETED').toLowerCase()}`));
            console.log(colors.gray('  The shell will show the final state of the task'));
        }

        // Check if worktree exists
        if (!task.worktreePath || !existsSync(task.worktreePath)) {
            console.log(colors.red('\n✗ No worktree found for this task'));
            return;
        }

        console.log(colors.gray('Worktree: ') + colors.cyan(task.worktreePath));
        console.log(colors.gray('Branch: ') + colors.cyan(task.branchName));
        
        telemetry?.eventShell();

        if (options.container) {
            // Check if Docker is available
            try {
                spawnSync('docker', ['--version'], { stdio: 'pipe' });
            } catch (error) {
                console.log('');
                console.log(colors.red('✗ Docker is not available'));
                console.log(colors.gray('  Please install Docker to use the interactive shell'));
                return;
            }
        }

        // Check if we're in a git repository
        try {
            spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
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

        const spinner = yoctoSpinner({ text: 'Starting shell...' }).start();

        let shellProcess = undefined;
        if (options.container) {
            try {
                const containerName = `rover-shell-${numericTaskId}`;

                // Clean up any existing container with same name
                try {
                    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'pipe' });
                } catch (error) {
                    // Container doesn't exist, which is fine
                }

                // Build Docker run command for interactive shell
                const dockerArgs = [
                    'run',
                    '--rm', // Remove container when it exits
                    '-it', // Interactive with TTY
                    '--name', containerName,
                    '-v', `${task.worktreePath}:/workspace:rw`,
                    '-w', '/workspace',
                    'node:24-alpine',
                    '/bin/sh'
                ];

                spinner.success('Shell started');
                console.log(colors.cyan('🚀 Starting interactive shell in Docker container...'));
                console.log(colors.gray(`   Working directory: /workspace`));
                console.log(colors.gray(`   Container: ${containerName}`));
                console.log('');

                // Start Docker container with direct stdio inheritance for true interactivity
                shellProcess = spawn('docker', dockerArgs, {
                    stdio: 'inherit' // This gives full control to the user
                });

                // Handle process interruption (Ctrl+C)
                process.on('SIGINT', () => {
                    console.log(colors.yellow('\n\n⚠ Stopping shell session...'));
                    try {
                        spawnSync('docker', ['stop', containerName], { stdio: 'pipe' });
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
        } else {
            try {
                shellProcess = spawn(process.env.SHELL || '/bin/sh', [], { cwd: task.worktreePath, stdio: 'inherit' });

                spinner.success('Shell started');
                console.log(colors.cyan('🚀 Starting interactive shell in workspace...'));
                console.log(colors.gray(`   Working directory: ${task.worktreePath}`));
            } catch (error) {
                spinner.error('Failed to start shell');
                console.error(colors.red('Error starting shell:'), error);
            }
        }

        if (shellProcess) {
            // Handle process completion
            shellProcess.on('close', (code) => {
                console.log('');
                if (code === 0) {
                    console.log(colors.green('✓ Shell session ended'));
                } else {
                    console.log(colors.yellow(`⚠ Shell session ended with code ${code}`));
                }
                console.log('');
                console.log(colors.cyan('💡 Your worktree is preserved at: ') + colors.white(task.worktreePath));
                console.log(colors.gray('   Use ') + colors.cyan(`rover diff ${numericTaskId}`) + colors.gray(' to see any changes you made'));
                console.log(colors.gray('   Use ') + colors.cyan(`rover merge ${numericTaskId}`) + colors.gray(' to merge when ready'));
            });

            shellProcess.on('error', (error) => {
                console.log('');
                console.error(colors.red('Error running shell:'), error);
            });
        }
    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            console.log(colors.red(`✗ ${error.message}`));
        } else {
            console.error(colors.red('Error opening task shell:'), error);
        }
    } finally {
        await telemetry?.shutdown();
    }
};
