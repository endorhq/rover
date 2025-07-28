import colors from 'ansi-colors';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';

/**
 * Get available iterations for a task
 */
const getAvailableIterations = (taskId: string): number[] => {
    try {
        const roverPath = join(process.cwd(), '.rover');
        const taskPath = join(roverPath, 'tasks', taskId);
        const iterationsPath = join(taskPath, 'iterations');
        
        if (!existsSync(iterationsPath)) {
            return [];
        }
        
        return readdirSync(iterationsPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => parseInt(dirent.name, 10))
            .filter(num => !isNaN(num))
            .sort((a, b) => a - b); // Sort ascending
            
    } catch (error) {
        console.error('Error getting available iterations:', error);
        return [];
    }
};

/**
 * Get container ID for a specific iteration
 */
const getContainerIdForIteration = (taskId: string, iterationNumber: number): string | null => {
    try {
        const roverPath = join(process.cwd(), '.rover');
        const taskPath = join(roverPath, 'tasks', taskId);
        const descriptionPath = join(taskPath, 'description.json');
        
        if (!existsSync(descriptionPath)) {
            return null;
        }
        
        const taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));
        
        // For now, we'll use the current container ID as we don't store per-iteration container IDs
        // This is a limitation - we can only show logs for the most recent execution
        return taskData.containerId || null;
        
    } catch (error) {
        return null;
    }
};

export const logsCommand = (taskId: string, iterationNumber?: string, options: { follow?: boolean } = {}) => {
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
        // Load task data for context
        const taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));
        
        // Parse iteration number if provided
        let targetIteration: number | undefined;
        if (iterationNumber) {
            targetIteration = parseInt(iterationNumber, 10);
            if (isNaN(targetIteration)) {
                console.log(colors.red(`✗ Invalid iteration number: '${iterationNumber}'`));
                return;
            }
        }
        
        // Get available iterations for context
        const availableIterations = getAvailableIterations(taskId);
        
        if (availableIterations.length === 0) {
            console.log(colors.yellow(`⚠ No iterations found for task '${taskId}'`));
            console.log(colors.gray('  Run ') + colors.cyan(`rover task ${taskId}`) + colors.gray(' to start the task'));
            return;
        }
        
        // Determine which iteration to show logs for
        const actualIteration = targetIteration || availableIterations[availableIterations.length - 1];
        
        // Check if specific iteration exists (if requested)
        if (targetIteration && !availableIterations.includes(targetIteration)) {
            console.log(colors.red(`✗ Iteration ${targetIteration} not found for task '${taskId}'`));
            console.log(colors.gray('Available iterations: ') + colors.cyan(availableIterations.join(', ')));
            return;
        }
        
        // Get container ID (limitation: only works for most recent execution)
        const containerId = getContainerIdForIteration(taskId, actualIteration);
        
        if (!containerId) {
            console.log(colors.yellow(`⚠ No container found for task '${taskId}'`));
            console.log(colors.gray('  Logs are only available for recently executed tasks'));
            console.log(colors.gray('  Run ') + colors.cyan(`rover task ${taskId}`) + colors.gray(' to start the task'));
            return;
        }
        
        // Display header
        console.log(colors.bold(`📋 Task ${taskId} Logs`));
        console.log(colors.gray('Title: ') + colors.white(taskData.title));
        console.log(colors.gray('Iteration: ') + colors.cyan(`#${actualIteration}`));
        console.log(colors.gray('Container ID: ') + colors.cyan(containerId.substring(0, 12)));
        
        if (availableIterations.length > 1) {
            console.log(colors.gray('Available iterations: ') + colors.cyan(availableIterations.join(', ')));
        }
        
        console.log('');
        console.log(colors.bold('📝 Docker Execution Log:'));
        
        if (options.follow) {
            // Follow logs in real-time
            console.log(colors.gray('Following logs... (Press Ctrl+C to exit)'));
            console.log('');
            
            try {
                const logsProcess = spawn('docker', ['logs', '-f', containerId], {
                    stdio: ['inherit', 'pipe', 'pipe']
                });
                
                // Handle stdout
                logsProcess.stdout?.on('data', (data) => {
                    process.stdout.write(data);
                });
                
                // Handle stderr
                logsProcess.stderr?.on('data', (data) => {
                    process.stderr.write(data);
                });
                
                // Handle process completion
                logsProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log(colors.green('\n✓ Log following completed'));
                    } else {
                        console.log(colors.yellow(`\n⚠ Log following ended with code ${code}`));
                    }
                });
                
                logsProcess.on('error', (error) => {
                    console.error(colors.red('\nError following logs:'), error.message);
                });
                
                // Handle process interruption (Ctrl+C)
                process.on('SIGINT', () => {
                    console.log(colors.yellow('\n\n⚠ Stopping log following...'));
                    logsProcess.kill('SIGTERM');
                    process.exit(0);
                });
                
            } catch (error: any) {
                if (error.message.includes('No such container')) {
                    console.log(colors.yellow('Container no longer exists'));
                    console.log(colors.gray('Cannot follow logs for a non-existent container'));
                } else {
                    console.log(colors.red('Error following Docker logs:'));
                    console.log(colors.red(error.message));
                }
            }
            
        } else {
            // Get logs using docker logs command (one-time)
            try {
                const logs = execSync(`docker logs ${containerId}`, { 
                    encoding: 'utf8',
                    stdio: 'pipe'
                });
                
                if (logs.trim() === '') {
                    console.log(colors.yellow('No logs available for this container'));
                } else {
                    // Display logs with basic formatting
                    const logLines = logs.split('\n');
                    
                    for (const line of logLines) {
                        if (line.trim() === '') {
                            console.log('');
                            continue;
                        }

                        console.log(line);
                    }
                }
                
            } catch (dockerError: any) {
                if (dockerError.message.includes('No such container')) {
                    console.log(colors.yellow('Container no longer exists'));
                    console.log(colors.gray('Docker containers are removed after completion'));
                    console.log(colors.gray('Logs are only available while the container is running or recently stopped'));
                } else {
                    console.log(colors.red('Error retrieving Docker logs:'));
                    console.log(colors.red(dockerError.message));
                }
            }
        }
        
        // Only show tips if not in follow mode (since follow mode blocks)
        if (!options.follow) {
            console.log('');
            
            // Show tips
            if (availableIterations.length > 1) {
                const otherIterations = availableIterations.filter(i => i !== actualIteration);
                if (otherIterations.length > 0) {
                    console.log(colors.gray('💡 Tips:'));
                    console.log(colors.gray('   Use ') + colors.cyan(`rover logs ${taskId} <iteration>`) + colors.gray(' to view specific iteration (if container exists)'));
                    console.log(colors.gray('   Available: ') + colors.cyan(otherIterations.join(', ')));
                }
            }
            console.log(colors.gray('   Use ') + colors.cyan(`rover logs ${taskId} --follow`) + colors.gray(' to follow logs in real-time'));
            console.log(colors.gray('   Use ') + colors.cyan(`rover diff ${taskId}`) + colors.gray(' to see code changes'));
            console.log(colors.gray('   Use ') + colors.cyan(`rover task ${taskId} --follow`) + colors.gray(' to follow live logs during execution'));
            console.log(colors.gray('   Note: Logs are only available while containers exist (recent executions)'));
        }
        
    } catch (error) {
        console.error(colors.red('Error reading task logs:'), error);
    }
};