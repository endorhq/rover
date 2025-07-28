import enquirer from 'enquirer';
import colors from 'ansi-colors';
import yoctoSpinner from 'yocto-spinner';
import { ClaudeAI } from '../utils/ai-claude.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskExpansion } from '../types.js';
import { getNextTaskId } from '../utils/task-id.js';
import { execSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { formatTaskStatus } from '../utils/task-status.js';

const { prompt } = enquirer;

/**
 * Command validations.
 */
const validations = (): boolean => {
    // Check if we're in a git repository
    try {
        execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
    } catch (error) {
        console.log(colors.red('✗ Not in a git repository'));
        console.log(colors.gray('  Git worktree requires the project to be in a git repository'));
        return false;
    }

    // Check if Claude credentials exist
    const claudeFile = join(homedir(), '.claude.json');
    const claudeCreds = join(homedir(), '.claude', '.credentials.json');

    if (!existsSync(claudeFile)) {
        console.log(colors.red('\n✗ Claude configuration not found'));
        console.log(colors.gray('  Please run `claude` first to configure it'));
        return false;
    }

    if (!existsSync(claudeCreds)) {
        console.log(colors.red('\n✗ Claude credentials not found'));
        console.log(colors.gray('  Please run `claude auth` first to set up credentials'));
        return false;
    }

    return true;
}

/**
 * Update task metadata with execution information
 */
const updateTaskMetadata = (taskId: string, updates: any) => {
    try {
        const endorPath = join(process.cwd(), '.rover');
        const tasksPath = join(endorPath, 'tasks');
        const taskPath = join(tasksPath, taskId);
        const descriptionPath = join(taskPath, 'description.json');
        
        if (existsSync(descriptionPath)) {
            const taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));
            const updatedData = { ...taskData, ...updates };
            writeFileSync(descriptionPath, JSON.stringify(updatedData, null, 2));
        }
    } catch (error) {
        console.error(colors.red('Error updating task metadata:'), error);
    }
};

/**
 * Start environment using containers
 */
export const startDockerExecution = async (taskId: string, taskData: any, worktreePath: string, iterationPath: string, customTaskDescriptionPath?: string, followMode?: boolean) => {
    const containerName = `rover-task-${taskId}-${taskData.iterations}`;
    
    try {
        // Check if Docker is available
        execSync('docker --version', { stdio: 'pipe' });
    } catch (error) {
        console.log(colors.red('\n✗ Docker is not available'));
        console.log(colors.gray('  Please install Docker to use automated task execution'));
        return;
    }

    // Check if Claude credentials exist
    const claudeFile = join(homedir(), '.claude.json');
    const claudeCreds = join(homedir(), '.claude', '.credentials.json');
    if (!existsSync(claudeFile)) {
        console.log(colors.red('\n✗ Claude credentials not found'));
        console.log(colors.gray('  Please run `claude auth` first to set up credentials'));
        return;
    }

    console.log(colors.bold('\n🐳 Starting Docker container for task execution\n'));
    
    // Clean up any existing container with same name
    try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' });
    } catch (error) {
        // Container doesn't exist, which is fine
    }

    const spinner = yoctoSpinner({ text: 'Starting container...' }).start();

    try {
        // Get path to setup script and task description
        const taskDescriptionPath = customTaskDescriptionPath || join(process.cwd(), '.rover', 'tasks', taskId, 'description.json');
        
        // Build Docker run command with mounts
        const dockerArgs = [
            'run',
            '--name', containerName,
            // For now, do not remove for logs
            // '--rm'
        ];
        
        // Add interactive flag only in follow mode
        if (followMode) {
            dockerArgs.push('-it');
        } else {
            dockerArgs.push('-d'); // Detached mode for background execution
        }
        
        const currentDir = dirname(fileURLToPath(import.meta.url));
        const setupScriptPath = join(currentDir, 'docker-setup.sh');

        dockerArgs.push(
            '-v', `${worktreePath}:/workspace:rw`,
            '-v', `${iterationPath}:/output:rw`,
            `-v`, `${claudeFile}:/.claude.json:ro`,
            `-v`, `${claudeCreds}:/.credentials.json:ro`,
            '-v', `${setupScriptPath}:/setup.sh:ro`,
            '-v', `${taskDescriptionPath}:/task/description.json:ro`,
            '-w', '/workspace',
            'node:24-alpine',
            '/bin/sh', '/setup.sh'
        );

        if (followMode) {
            spinner.success('Container started');
            console.log(colors.cyan('Running automated task execution with Claude (follow mode)...\n'));

            // Start Docker container with streaming output
            const dockerProcess = spawn('docker', dockerArgs, {
                stdio: ['inherit', 'pipe', 'pipe']
            });

            let currentStep = 'Initializing';
            console.log(colors.yellow(`📋 Current step: ${currentStep}`));

            // Handle stdout
            dockerProcess.stdout?.on('data', (data) => {
                const output = data.toString();
                
                // Update current step based on output
                if (output.includes('Installing Claude Code CLI')) {
                    if (currentStep !== 'Installing Claude Code CLI') {
                        currentStep = 'Installing Claude Code CLI';
                        console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                    }
                } else if (output.includes('Creating claude user')) {
                    if (currentStep !== 'Setting up claude user') {
                        currentStep = 'Setting up claude user';
                        console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                    }
                } else if (output.includes('Starting Claude Code execution')) {
                    if (currentStep !== 'Starting Claude Code execution') {
                        currentStep = 'Starting Claude Code execution';
                        console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                    }
                } else if (output.includes('Task execution completed')) {
                    if (currentStep !== 'Task execution complete') {
                        currentStep = 'Task execution complete';
                        console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                    }
                }

                // Display output with proper formatting
                process.stdout.write(colors.gray(output));
            });

            // Handle stderr
            dockerProcess.stderr?.on('data', (data) => {
                process.stderr.write(colors.gray(data.toString()));
            });

            // Handle process completion
            dockerProcess.on('close', (code) => {
                if (code === 0) {
                    console.log(colors.green('\n✓ Task execution completed successfully'));
                    // Update task metadata
                    updateTaskMetadata(taskId, { 
                        executionStatus: 'completed',
                        completedAt: new Date().toISOString(),
                        exitCode: code 
                    });
                } else {
                    console.log(colors.red(`\n✗ Task execution failed with code ${code}`));
                    // Update task metadata
                    updateTaskMetadata(taskId, { 
                        executionStatus: 'failed',
                        failedAt: new Date().toISOString(),
                        exitCode: code 
                    });
                }
            });

            dockerProcess.on('error', (error) => {
                console.error(colors.red('\nError running Docker container:'), error);
                // Update task metadata
                updateTaskMetadata(taskId, { 
                    executionStatus: 'error',
                    error: error.message,
                    errorAt: new Date().toISOString()
                });
            });

            // Handle process interruption (Ctrl+C)
            process.on('SIGINT', () => {
                console.log(colors.yellow('\n\n⚠ Stopping task execution...'));
                try {
                    execSync(`docker stop ${containerName}`, { stdio: 'pipe' });
                    console.log(colors.green('✓ Container stopped'));
                } catch (error) {
                    console.log(colors.red('✗ Failed to stop container'));
                }
                process.exit(0);
            });
        } else {
            // Background mode execution
            try {
                const containerId = execSync(`docker ${dockerArgs.join(' ')}`, { 
                    stdio: 'pipe', 
                    encoding: 'utf8' 
                }).trim();
                
                spinner.success('Container started in background');
                console.log(colors.cyan(`🐳 Task is running in background (Container ID: ${containerId.substring(0, 12)})`));
                console.log(colors.gray(`   Use `) + colors.cyan(`rover list`) + colors.gray(` to monitor progress`));
                console.log(colors.gray(`   Use `) + colors.cyan(`rover logs ${taskId}`) + colors.gray(` to view logs`));
                console.log(colors.gray(`   Use `) + colors.cyan(`rover task ${taskId} --follow`) + colors.gray(` to follow the logs`));
                
                // Update task metadata with container ID
                updateTaskMetadata(taskId, { 
                    containerId: containerId,
                    executionStatus: 'running',
                    runningAt: new Date().toISOString()
                });
                
            } catch (error: any) {
                spinner.error('Failed to start container in background');
                console.error(colors.red('Error starting Docker container:'), error.message);
                
                // Update task metadata
                updateTaskMetadata(taskId, { 
                    executionStatus: 'error',
                    error: error.message,
                    errorAt: new Date().toISOString()
                });
            }
        }

    } catch (error) {
        spinner.error('Failed to start container');
        console.error(colors.red('Error starting Docker container:'), error);
    }
}

/**
 * Task commands
 */
export const taskCommand = async (initPrompt?: string, options: { from?: string, follow?: boolean } = {}) => {
    // Follow
    const { follow } = options;

    // Check if rover is initialized
    const roverPath = join(process.cwd(), '.rover');
    if (!existsSync(roverPath)) {
        console.log(colors.red('✗ Rover is not initialized in this directory'));
        console.log(colors.gray('  Run ') + colors.cyan('rover init') + colors.gray(' first'));
        process.exit(1);
    }

    // Run initial validations
    if (!validations()) {
        process.exit(1);
    }

    console.log(colors.bold('\n📝 Create a new task\n'));

    let description = initPrompt?.trim();

    // Get initial task description
    if (typeof description !== 'string' || description.length == 0) {
        const { input } = await prompt<{ input: string }>({
            type: 'input',
            name: 'description',
            message: 'Briefly describe the task you want to accomplish:',
            validate: (value) => value.trim().length > 0 || 'Please provide a description'
        });

        description = input;
    }

    let taskData: TaskExpansion | null = null;
    let satisfied = false;

    while (!satisfied) {
        // Expand task with Claude
        const spinner = yoctoSpinner({ text: 'Expanding task description with AI...' }).start();
        
        try {
            const expanded = await ClaudeAI.expandTask(
                taskData ? `${taskData.title}: ${taskData.description}` : description,
                process.cwd()
            );
            
            if (expanded) {
                spinner.success('Task expanded!');
                taskData = expanded;
                
                // Display the expanded task
                console.log('\n' + colors.bold('Task Details:'));
                console.log(colors.gray('Title: ') + colors.cyan(taskData.title));
                console.log(colors.gray('Description: ') + colors.white(taskData.description));
                
                // Ask for confirmation
                const { confirm } = await prompt<{ confirm: string }>({
                    type: 'select',
                    name: 'confirm',
                    message: '\nAre you satisfied with this task?',
                    choices: [
                        { name: 'yes', message: 'Yes, looks good!' },
                        { name: 'refine', message: 'No, I want to add more details' },
                        { name: 'cancel', message: 'Cancel task creation' }
                    ]
                });

                if (confirm === 'yes') {
                    satisfied = true;
                } else if (confirm === 'refine') {
                    // Get additional details
                    const { additionalInfo } = await prompt<{ additionalInfo: string }>({
                        type: 'input',
                        name: 'additionalInfo',
                        message: 'Provide additional information or corrections:',
                        validate: (value) => value.trim().length > 0 || 'Please provide additional information'
                    });
                    
                    // Update the description for next iteration
                    taskData.description = `${taskData.description} Additional context: ${additionalInfo}`;
                } else {
                    // Cancel
                    console.log(colors.yellow('\n⚠ Task creation cancelled'));
                    return;
                }
            } else {
                spinner.error('Failed to expand task');
                console.log(colors.yellow('\n⚠ Claude AI is not available. Creating task with original description.'));
                taskData = {
                    title: description.split(' ').slice(0, 5).join(' '),
                    description: description
                };
                satisfied = true;
            }
        } catch (error) {
            spinner.error('Failed to expand task');
            console.error(colors.red('Error:'), error);
            
            // Fallback to manual task creation
            taskData = {
                title: description.split(' ').slice(0, 5).join(' '),
                description: description
            };
            satisfied = true;
        }
    }

    if (taskData) {
        // Generate auto-increment ID for the task
        const taskId = getNextTaskId();
        
        // Create .rover/tasks directory structure
        const endorPath = join(process.cwd(), '.rover');
        const tasksPath = join(endorPath, 'tasks');
        const taskPath = join(tasksPath, taskId.toString());
        
        // Ensure directories exist
        if (!existsSync(endorPath)) {
            mkdirSync(endorPath, { recursive: true });
        }
        if (!existsSync(tasksPath)) {
            mkdirSync(tasksPath, { recursive: true });
        }
        mkdirSync(taskPath, { recursive: true });
        
        // Create description.json with task metadata and status
        const taskMetadata = {
            id: taskId,
            title: taskData.title,
            description: taskData.description,
            status: 'NEW',
            createdAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            lastIterationAt: new Date().toISOString(),
            iterations: 1,
            worktreePath: '',
            branchName: ''
        };
        
        const descriptionPath = join(taskPath, 'description.json');
        writeFileSync(descriptionPath, JSON.stringify(taskMetadata, null, 2));
        
        console.log(colors.green('\n✓ Task created successfully!'));
        console.log(colors.gray(`  Task ID: ${taskId}`));
        console.log(colors.gray(`  Saved to: .rover/tasks/${taskId}/description.json\n`));

        // Setup git worktree and branch
        const worktreePath = join(taskPath, 'workspace');
        const branchName = `task-${taskId}`;

        // Check if worktree and branch already exist
        const spinner = yoctoSpinner({ text: 'Creating git workspace...' }).start();
        
        try {
            // Check if branch already exists
            let branchExists = false;
            try {
                execSync(`git show-ref --verify --quiet refs/heads/${branchName}`, { stdio: 'pipe' });
                branchExists = true;
            } catch (error) {
                // Branch doesn't exist, which is fine for new worktree
            }
            
            if (branchExists) {
                // Create worktree from existing branch
                execSync(`git worktree add "${worktreePath}" "${branchName}"`, { stdio: 'pipe' });
                spinner.success('Git workspace created from existing branch');
                console.log(colors.cyan('🔄 Resuming work on existing branch'));
            } else {
                // Create new worktree with a new branch
                execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, { stdio: 'pipe' });
                spinner.success('Git workspace created');
            }
        } catch (error) {
            spinner.error('Failed to create workspace');
            console.error(colors.red('Error creating git workspace:'), error);
            return;
        }

        taskMetadata.status = 'IN_PROGRESS';
        taskMetadata.startedAt = new Date().toISOString();

        const iterationPath = join(taskPath, 'iterations', taskMetadata.iterations.toString());
        mkdirSync(iterationPath, { recursive: true });

        taskMetadata.worktreePath = worktreePath;
        taskMetadata.branchName = branchName;

        // Save updated task data
        writeFileSync(descriptionPath, JSON.stringify(taskData, null, 2));
        
        
        console.log(colors.bold('\n🚀 Task Started\n'));
        console.log(colors.gray('ID: ') + colors.cyan(taskId.toString()));
        console.log(colors.gray('Title: ') + colors.white(taskData.title));
        console.log(colors.gray('Status: ') + colors.yellow(formatTaskStatus('IN_PROGRESS')));
        console.log(colors.gray('Started: ') + colors.white(new Date().toLocaleString()));
        console.log(colors.gray('Workspace: ') + colors.cyan(worktreePath));
        console.log(colors.gray('Branch: ') + colors.cyan(branchName));
        
        console.log(colors.green('\n✓ Task started with dedicated workspace'));
        
        console.log(colors.gray('  You can now work in: ') + colors.cyan(worktreePath));

        // Start Docker container for task execution
        await startDockerExecution(taskId.toString(), taskData, worktreePath, iterationPath, undefined, follow);
    }
};