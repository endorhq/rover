import enquirer from 'enquirer';
import colors from 'ansi-colors';
import yoctoSpinner from 'yocto-spinner';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskExpansion, AIProvider } from '../types.js';
import { getNextTaskId } from '../utils/task-id.js';
import { execSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { formatTaskStatus } from '../utils/task-status.js';
import { createAIProvider } from '../utils/ai-factory.js';
import { TaskDescription, TaskNotFoundError, TaskValidationError } from '../lib/description.js';
import { PromptBuilder } from '../lib/prompt.js';
import { SetupBuilder } from '../lib/setup.js';
import { UserSettings, AI_AGENT } from '../lib/config.js';
import { generateBranchName } from '../utils/branch-name.js';
import { request } from 'node:https';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';

const { prompt } = enquirer;
const execAsync = promisify(exec);

/**
 * Command validations.
 */
const validations = (selectedAiAgent?: string, isJsonMode?: boolean, followMode?: boolean): boolean => {
    // Check if we're in a git repository
    try {
        execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
    } catch (error) {
        if (!isJsonMode) {
            console.log(colors.red('✗ Not in a git repository'));
            console.log(colors.gray('  Git worktree requires the project to be in a git repository'));
        }
        return false;
    }

    // Check AI agent credentials based on selected agent
    if (selectedAiAgent === 'claude') {
        const claudeFile = join(homedir(), '.claude.json');

        if (!existsSync(claudeFile)) {
            if (!isJsonMode) {
                console.log(colors.red('\n✗ Claude configuration not found'));
                console.log(colors.gray('  Please run `claude` first to configure it'));
            }
            return false;
        }
    } else if (selectedAiAgent === 'gemini') {
        // Check Gemini credentials if needed
        const geminiFile = join(homedir(), '.gemini', 'settings.json');
        const geminiCreds = join(homedir(), '.gemini', 'oauth_creds.json');

        if (!existsSync(geminiFile)) {
            if (!isJsonMode) {
                console.log(colors.red('\n✗ Gemini configuration not found'));
                console.log(colors.gray('  Please run `gemini` first to configure it'));
            }
            return false;
        }

        if (!existsSync(geminiCreds)) {
            if (!isJsonMode) {
                console.log(colors.red('\n✗ Gemini credentials not found'));
                console.log(colors.gray('  Please run `gemini` first to set up credentials'));
            }
            return false;
        }
    }

    if (isJsonMode && followMode) {
        return false;
    }

    return true;
}

/**
 * Update task metadata with execution information
 */
const updateTaskMetadata = (taskId: number, updates: any, jsonMode?: boolean) => {
    try {
        if (TaskDescription.exists(taskId)) {
            const task = TaskDescription.load(taskId);

            // Apply updates to the task object based on the updates parameter
            if (updates.status) {
                task.setStatus(updates.status);
            }
            if (updates.title) {
                task.updateTitle(updates.title);
            }
            if (updates.description) {
                task.updateDescription(updates.description);
            }
            if (updates.worktreePath && updates.branchName) {
                task.setWorkspace(updates.worktreePath, updates.branchName);
            }

            // Handle Docker execution metadata
            if (updates.containerId && updates.executionStatus) {
                task.setContainerInfo(updates.containerId, updates.executionStatus);
            } else if (updates.executionStatus) {
                task.updateExecutionStatus(updates.executionStatus, {
                    exitCode: updates.exitCode,
                    error: updates.error
                });
            }
        }
    } catch (error) {
        // Silently fail in JSON mode, otherwise log the error
        if (!jsonMode) {
            console.error(colors.red('Error updating task metadata:'), error);
        }
    }
};

/**
 * Start environment using containers
 */
export const startDockerExecution = async (taskId: number, taskData: any, worktreePath: string, iterationPath: string, selectedAiAgent: string, customTaskDescriptionPath?: string, followMode?: boolean, jsonMode?: boolean) => {
    const containerName = `rover-task-${taskId}-${taskData.iterations}`;

    try {
        // Check if Docker is available
        execSync('docker --version', { stdio: 'pipe' });
    } catch (error) {
        if (!jsonMode) {
            console.log(colors.red('\n✗ Docker is not available'));
            console.log(colors.gray('  Please install Docker to use automated task execution'));
        }
        return;
    }

    // Load task description
    const taskDescriptionPath = customTaskDescriptionPath || join(process.cwd(), '.rover', 'tasks', taskId.toString(), 'description.json');
    const task = TaskDescription.load(taskId);

    // Generate setup script using SetupBuilder
    const setupBuilder = new SetupBuilder(task, selectedAiAgent);
    const setupScriptPath = setupBuilder.generateSetupScript();
    const setupMcpScriptPath = setupBuilder.generateSetupMcpScript();

    // Generate prompts using PromptBuilder
    const promptsDir = join(process.cwd(), '.rover', 'tasks', taskId.toString(), 'iterations', task.iterations.toString(), 'prompts');
    const promptBuilder = new PromptBuilder(selectedAiAgent);
    promptBuilder.generatePromptFiles(task, promptsDir);

    // Check AI agent credentials based on selected agent
    let credentialsValid = true;
    const dockerMounts: string[] = [];

    if (selectedAiAgent === 'claude') {
        const claudeFile = join(homedir(), '.claude.json');
        const claudeCreds = join(homedir(), '.claude', '.credentials.json');

        dockerMounts.push(`-v`, `${claudeFile}:/.claude.json:ro`);

        if (existsSync(claudeCreds)) {
            dockerMounts.push(`-v`, `${claudeCreds}:/.credentials.json:ro`);
        }
    } else if (selectedAiAgent === 'gemini') {
        // Gemini might use environment variables or other auth methods
        const geminiFolder = join(homedir(), '.gemini');

        dockerMounts.push(`-v`, `${geminiFolder}:/.gemini:ro`);
    }

    if (!credentialsValid) {
        return;
    }

    if (!jsonMode) {
        console.log(colors.bold('\n🐳 Starting Docker container for task execution\n'));
    }

    // Clean up any existing container with same name
    try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' });
    } catch (error) {
        // Container doesn't exist, which is fine
    }

    const spinner = !jsonMode ? yoctoSpinner({ text: 'Starting container...' }).start() : null;

    try {

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

        dockerArgs.push(
            '-v', `${worktreePath}:/workspace:rw`,
            '-v', `${iterationPath}:/output:rw`,
            ...dockerMounts,
            '-v', `${setupScriptPath}:/setup.sh:ro`,
            '-v', `${setupMcpScriptPath}:/setup-mcp.sh:ro`,
            '-v', `${taskDescriptionPath}:/task/description.json:ro`,
            '-v', `${promptsDir}:/prompts:ro`,
            '-w', '/workspace',
            'node:24-alpine',
            '/bin/sh', '/setup.sh'
        );

        if (followMode) {
            if (spinner) spinner.success('Container started');
            if (!jsonMode) {
                console.log(colors.cyan(`Running automated task execution with ${selectedAiAgent} (follow mode)...\n`));
            }

            // Start Docker container with streaming output
            const dockerProcess = spawn('docker', dockerArgs, {
                stdio: ['inherit', 'pipe', 'pipe']
            });

            let currentStep = 'Initializing';
            if (!jsonMode) {
                console.log(colors.yellow(`📋 Current step: ${currentStep}`));
            }

            // Handle stdout
            dockerProcess.stdout?.on('data', (data) => {
                const output = data.toString();

                // Update current step based on output
                if (output.includes(`Installing ${selectedAiAgent} CLI`)) {
                    if (currentStep !== `Installing ${selectedAiAgent} CLI`) {
                        currentStep = `Installing ${selectedAiAgent} CLI`;
                        if (!jsonMode) {
                            console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                        }
                    }
                } else if (output.includes('Creating agent user')) {
                    if (currentStep !== 'Setting up agent user') {
                        currentStep = 'Setting up agent user';
                        if (!jsonMode) {
                            console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                        }
                    }
                } else if (output.includes('Starting context phase')) {
                    if (currentStep !== 'Context Analysis') {
                        currentStep = 'Context Analysis';
                        if (!jsonMode) {
                            console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                        }
                    }
                } else if (output.includes('Starting plan phase')) {
                    if (currentStep !== 'Planning') {
                        currentStep = 'Planning';
                        if (!jsonMode) {
                            console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                        }
                    }
                } else if (output.includes('Starting implement phase')) {
                    if (currentStep !== 'Implementation') {
                        currentStep = 'Implementation';
                        if (!jsonMode) {
                            console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                        }
                    }
                } else if (output.includes('Starting review phase')) {
                    if (currentStep !== 'Code Review') {
                        currentStep = 'Code Review';
                        if (!jsonMode) {
                            console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                        }
                    }
                } else if (output.includes('Starting apply_review phase')) {
                    if (currentStep !== 'Applying Review Fixes') {
                        currentStep = 'Applying Review Fixes';
                        if (!jsonMode) {
                            console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                        }
                    }
                } else if (output.includes('Starting summary phase')) {
                    if (currentStep !== 'Creating Summary') {
                        currentStep = 'Creating Summary';
                        if (!jsonMode) {
                            console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                        }
                    }
                } else if (output.includes('Task execution completed')) {
                    if (currentStep !== 'Task execution complete') {
                        currentStep = 'Task execution complete';
                        if (!jsonMode) {
                            console.log(colors.yellow(`📋 Current step: ${currentStep}`));
                        }
                    }
                }

                // Display output with proper formatting
                if (!jsonMode) {
                    process.stdout.write(colors.gray(output));
                }
            });

            // Handle stderr
            dockerProcess.stderr?.on('data', (data) => {
                if (!jsonMode) {
                    process.stderr.write(colors.gray(data.toString()));
                }
            });

            // Handle process completion
            dockerProcess.on('close', (code) => {
                if (code === 0) {
                    if (!jsonMode) {
                        console.log(colors.green('\n✓ Task execution completed successfully'));
                    }
                    // Update task metadata
                    updateTaskMetadata(taskId, {
                        executionStatus: 'completed',
                        completedAt: new Date().toISOString(),
                        exitCode: code
                    }, jsonMode);
                } else {
                    if (!jsonMode) {
                        console.log(colors.red(`\n✗ Task execution failed with code ${code}`));
                    }
                    // Update task metadata
                    updateTaskMetadata(taskId, {
                        executionStatus: 'failed',
                        failedAt: new Date().toISOString(),
                        exitCode: code
                    }, jsonMode);
                }
            });

            dockerProcess.on('error', (error) => {
                if (!jsonMode) {
                    console.error(colors.red('\nError running Docker container:'), error);
                }
                // Update task metadata
                updateTaskMetadata(taskId, {
                    executionStatus: 'error',
                    error: error.message,
                    errorAt: new Date().toISOString()
                }, jsonMode);
            });

            // Handle process interruption (Ctrl+C)
            process.on('SIGINT', () => {
                if (!jsonMode) {
                    console.log(colors.yellow('\n\n⚠ Stopping task execution...'));
                }
                try {
                    execSync(`docker stop ${containerName}`, { stdio: 'pipe' });
                    if (!jsonMode) {
                        console.log(colors.green('✓ Container stopped'));
                    }
                } catch (error) {
                    if (!jsonMode) {
                        console.log(colors.red('✗ Failed to stop container'));
                    }
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

                if (spinner) spinner.success('Container started in background');
                if (!jsonMode) {
                    console.log(colors.cyan(`🐳 Task is running in background (Container ID: ${containerId.substring(0, 12)})`));
                    console.log(colors.gray(`   Use `) + colors.cyan(`rover list`) + colors.gray(` to monitor progress`));
                    console.log(colors.gray(`   Use `) + colors.cyan(`rover inspect ${taskId}`) + colors.gray(` to get task details`));
                    console.log(colors.gray(`   Use `) + colors.cyan(`rover logs -f ${taskId}`) + colors.gray(` to view logs`));
                }

                // Update task metadata with container ID
                updateTaskMetadata(taskId, {
                    containerId: containerId,
                    executionStatus: 'running',
                    runningAt: new Date().toISOString()
                }, jsonMode);

            } catch (error: any) {
                if (spinner) spinner.error('Failed to start container in background');
                if (!jsonMode) {
                    console.error(colors.red('Error starting Docker container:'), error.message);
                }

                // Update task metadata
                updateTaskMetadata(taskId, {
                    executionStatus: 'error',
                    error: error.message,
                    errorAt: new Date().toISOString()
                }, jsonMode);
            }
        }

    } catch (error) {
        if (spinner) spinner.error('Failed to start container');
        if (!jsonMode) {
            console.error(colors.red('Error starting Docker container:'), error);
        }
    }
}

/**
 * Check if a command exists
 */
const commandExists = (cmd: string): boolean => {
    try {
        execSync(`which ${cmd}`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
};

/**
 * Get GitHub repo info from remote URL
 */
const getGitHubRepoInfo = (remoteUrl: string): { owner: string; repo: string } | null => {
    // Handle various GitHub URL formats
    const patterns = [
        /github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/,
        /^git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/,
        /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/
    ];

    for (const pattern of patterns) {
        const match = remoteUrl.match(pattern);
        if (match) {
            return { owner: match[1], repo: match[2] };
        }
    }

    return null;
};

/**
 * Fetch GitHub issue using HTTPS API
 */
const fetchGitHubIssueViaAPI = async (owner: string, repo: string, issueNumber: string): Promise<{ title: string; body: string } | null> => {
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${owner}/${repo}/issues/${issueNumber}`,
            method: 'GET',
            headers: {
                'User-Agent': 'Rover-CLI',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        const req = request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const issue = JSON.parse(data);
                        resolve({
                            title: issue.title || '',
                            body: issue.body || ''
                        });
                    } catch {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
        });

        req.on('error', () => {
            resolve(null);
        });

        req.end();
    });
};

/**
 * Fetch GitHub issue using gh CLI
 */
const fetchGitHubIssueViaCLI = async (owner: string, repo: string, issueNumber: string): Promise<{ title: string; body: string } | null> => {
    try {
        const { stdout } = await execAsync(
            `gh issue view ${issueNumber} --repo ${owner}/${repo} --json title,body`
        );
        const issue = JSON.parse(stdout);
        return {
            title: issue.title || '',
            body: issue.body || ''
        };
    } catch {
        return null;
    }
};

/**
 * Fetch GitHub issue with fallback
 */
const fetchGitHubIssue = async (issueNumber: string, json: boolean): Promise<{ title: string; body: string } | null> => {
    try {
        // Try to get repo info from git remote
        const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
        const repoInfo = getGitHubRepoInfo(remoteUrl);

        if (!repoInfo) {
            if (!json) {
                console.log(colors.red('✗ Could not determine GitHub repository from git remote'));
            }
            return null;
        }

        if (!json) {
            console.log(colors.gray(`📍 Fetching issue #${issueNumber} from ${repoInfo.owner}/${repoInfo.repo}...`));
        }

        // Try API first
        let issueData = await fetchGitHubIssueViaAPI(repoInfo.owner, repoInfo.repo, issueNumber);

        // If API fails and gh CLI is available, try gh
        if (!issueData && commandExists('gh')) {
            if (!json) {
                console.log(colors.gray('  API request failed, trying gh CLI...'));
            }
            issueData = await fetchGitHubIssueViaCLI(repoInfo.owner, repoInfo.repo, issueNumber);
        }

        if (!issueData) {
            if (!json) {
                console.log(colors.red('✗ Failed to fetch GitHub issue'));
                console.log(colors.gray('  The issue might be private or not exist'));
            }
            return null;
        }

        return issueData;
    } catch (error) {
        if (!json) {
            console.log(colors.red('✗ Error fetching GitHub issue'));
        }
        return null;
    }
};

/**
 * Task commands
 */
export const taskCommand = async (initPrompt?: string, options: { fromGithub?: string, follow?: boolean, yes?: boolean, json?: boolean } = {}) => {
    // Extract options
    const { follow, yes, json, fromGithub } = options;

    // Check if rover is initialized
    const roverPath = join(process.cwd(), '.rover');
    if (!existsSync(roverPath)) {
        if (!json) {
            console.log(colors.red('✗ Rover is not initialized in this directory'));
            console.log(colors.gray('  Run ') + colors.cyan('rover init') + colors.gray(' first'));
        }
        process.exit(1);
    }

    // Load AI agent selection from user settings
    let selectedAiAgent = 'claude'; // default
    
    try {
        if (UserSettings.exists()) {
            const userSettings = UserSettings.load();
            selectedAiAgent = userSettings.defaultAiAgent || AI_AGENT.Claude;
            
            if (!json) {
                console.log(colors.white(`Selected ${selectedAiAgent} from user settings.`));
            }
        } else {
            if (!json) {
                console.log(colors.yellow('⚠ User settings not found, defaulting to Claude'));
                console.log(colors.gray('  Run `rover init` to configure AI agent preferences'));
            }
        }
    } catch (error) {
        if (!json) {
            console.log(colors.yellow('⚠ Could not load user settings, defaulting to Claude'));
        }
        selectedAiAgent = AI_AGENT.Claude;
    }

    // Run initial validations
    if (!validations(selectedAiAgent, json, follow)) {
        process.exit(1);
    }

    if (!json) {
        console.log(colors.bold('\n📝 Create a new task\n'));
    }

    let description = initPrompt?.trim() || '';
    let skipExpansion = false;
    let taskData: TaskExpansion | null = null;

    // Handle --from-github option
    if (fromGithub) {
        const issueData = await fetchGitHubIssue(fromGithub, json === true);
        if (issueData) {
            description = `${issueData.title}\n\n${issueData.body}`;
            skipExpansion = true;

            taskData = {
                title: issueData.title,
                description: issueData.body
            }

            if (!json) {
                console.log(colors.green('✓ GitHub issue fetched successfully'));
                console.log(colors.gray('Title: ') + colors.cyan(issueData.title));
                console.log(colors.gray('Body: ') + colors.white(issueData.body.substring(0, 100) + (issueData.body.length > 100 ? '...' : '')));
            }
        } else {
            // If GitHub fetch failed, exit
            process.exit(1);
        }
    }

    // Get initial task description
    if (!fromGithub && (typeof description !== 'string' || description.length == 0)) {
        if (yes) {
            // In non-interactive mode, we must have a description
            if (!json) {
                console.error(colors.red('✗ Task description is required in non-interactive mode'));
                console.error(colors.gray('  Please provide a description as an argument: rover task "your task description" --yes'));
            }
            process.exit(1);
        }

        const { input } = await prompt<{ input: string }>({
            type: 'input',
            name: 'input',
            message: 'Briefly describe the task you want to accomplish:',
            validate: (value) => value.trim().length > 0 || 'Please provide a description'
        });

        description = input;
    }

    let satisfied = skipExpansion;

    while (!satisfied) {
        // Expand task with selected AI provider
        const spinner = !json ? yoctoSpinner({ text: `Expanding task description with ${selectedAiAgent.charAt(0).toUpperCase() + selectedAiAgent.slice(1)}...` }).start() : null;

        try {
            const aiProvider = createAIProvider(selectedAiAgent);
            const expanded = await aiProvider.expandTask(
                taskData ? `${taskData.title}: ${taskData.description}` : description,
                process.cwd()
            );

            if (expanded) {
                if (spinner) spinner.success('Task expanded!');
                taskData = expanded;

                // Skip confirmation if using GitHub issue
                if (skipExpansion || yes) {
                    satisfied = true;
                } else {
                    // Display the expanded task
                    if (!json) {
                        console.log('\n' + colors.bold('Task Details:'));
                        console.log(colors.gray('Title: ') + colors.cyan(taskData.title));
                        console.log(colors.gray('Description: ') + colors.white(taskData.description));
                    }

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
                        if (!json) {
                            console.log(colors.yellow('\n⚠ Task creation cancelled'));
                        }
                        return;
                    }
                }
            } else {
                if (spinner) spinner.error('Failed to expand task');
                if (!json) {
                    console.log(colors.yellow(`\n⚠ ${selectedAiAgent.charAt(0).toUpperCase() + selectedAiAgent.slice(1)} AI is not available. Creating task with original description.`));
                }
                taskData = {
                    title: description.split(' ').slice(0, 5).join(' '),
                    description: description
                };
                satisfied = true;
            }
        } catch (error) {
            if (spinner) spinner.error('Failed to expand task');
            if (!json) {
                console.error(colors.red('Error:'), error);
            }

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

        // Create task using TaskDescription class
        const task = TaskDescription.create({
            id: taskId,
            title: taskData.title,
            description: taskData.description
        });

        if (!json) {
            console.log(colors.green('\n✓ Task created successfully!'));
            console.log(colors.gray(`  Task ID: ${task.id}`));
            console.log(colors.gray(`  Saved to: .rover/tasks/${taskId}/description.json\n`));
        }

        // Setup git worktree and branch
        const worktreePath = join(taskPath, 'workspace');
        const branchName = generateBranchName(taskId);

        // Check if worktree and branch already exist
        const workspaceSpinner = !json ? yoctoSpinner({ text: 'Creating git workspace...' }).start() : null;

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
                if (workspaceSpinner) workspaceSpinner.success('Git workspace created from existing branch');
                if (!json) console.log(colors.cyan('🔄 Resuming work on existing branch'));
            } else {
                // Create new worktree with a new branch
                execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, { stdio: 'pipe' });
                if (workspaceSpinner) workspaceSpinner.success('Git workspace created');
            }
        } catch (error) {
            if (workspaceSpinner) workspaceSpinner.error('Failed to create workspace');
            if (!json) {
                console.error(colors.red('Error creating git workspace:'), error);
            }
            return;
        }


        const iterationPath = join(taskPath, 'iterations', task.iterations.toString());
        mkdirSync(iterationPath, { recursive: true });

        // Update task with workspace information
        task.setWorkspace(worktreePath, branchName);
        task.markInProgress();

        if (!json) {
            console.log(colors.bold('\n🚀 Task Started\n'));
            console.log(colors.gray('ID: ') + colors.cyan(task.id.toString()));
            console.log(colors.gray('Title: ') + colors.white(task.title));
            console.log(colors.gray('Status: ') + colors.yellow(formatTaskStatus(task.status)));
            console.log(colors.gray('Started: ') + colors.white(new Date().toLocaleString()));
            console.log(colors.gray('Workspace: ') + colors.cyan(task.worktreePath));
            console.log(colors.gray('Branch: ') + colors.cyan(task.branchName));

            console.log(colors.green('\n✓ Task started with dedicated workspace'));

            console.log(colors.gray('  You can now work in: ') + colors.cyan(worktreePath));
        }

        // Start Docker container for task execution
        await startDockerExecution(taskId, taskData, worktreePath, iterationPath, selectedAiAgent, undefined, follow, json);

        if (json) {
            // Output final JSON after all operations are complete
            const finalJsonOutput = {
                success: true,
                taskId: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                createdAt: task.createdAt,
                startedAt: task.startedAt,
                workspace: task.worktreePath,
                branch: task.branchName,
                savedTo: `.rover/tasks/${taskId}/description.json`
            };
            console.log(JSON.stringify(finalJsonOutput, null, 2));
        }
    }
};
