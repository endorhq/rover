import enquirer from 'enquirer';
import colors from 'ansi-colors';
import yoctoSpinner from 'yocto-spinner';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:process';
import type { TaskExpansion } from '../types.js';
import { getNextTaskId } from '../utils/task-id.js';
import { homedir, tmpdir } from 'node:os';
import { createAIProvider } from '../utils/ai-factory.js';
import { TaskDescription } from '../lib/description.js';
import { PromptBuilder } from '../lib/prompt.js';
import { SetupBuilder } from '../lib/setup.js';
import { UserSettings, AI_AGENT } from '../lib/config.js';
import { IterationConfig } from '../lib/iteration.js';
import { generateBranchName } from '../utils/branch-name.js';
import { request } from 'node:https';
import { spawn } from 'node:child_process';
import { spawnSync } from '../lib/os.js';
import { checkGitHubCLI } from '../utils/system.js';
import { showRoverBanner, showRoverChat, showTips } from '../utils/display.js';
import { userInfo } from 'node:os';
import { getTelemetry } from '../lib/telemetry.js';
import { NewTaskProvider } from 'rover-telemetry';

const { prompt } = enquirer;

/**
 * Command validations.
 */
const validations = (selectedAiAgent?: string, isJsonMode?: boolean, followMode?: boolean): boolean => {
    // Check if we're in a git repository
    try {
        spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
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

export const findKeychainCredentials = (key: string): string => {
    return spawnSync('security', ['find-generic-password', '-s', key, '-w'], { stdio: 'pipe' })
        .stdout.toString()
}

/**
 * Start environment using containers
 */
export const startDockerExecution = async (taskId: number, task: TaskDescription, worktreePath: string, iterationPath: string, selectedAiAgent: string, followMode?: boolean, jsonMode?: boolean, debug?: boolean) => {
    const containerName = `rover-task-${taskId}-${task.iterations}`;

    try {
        // Check if Docker is available
        spawnSync('docker', ['--version'], { stdio: 'pipe' });
    } catch (error) {
        if (!jsonMode) {
            console.log(colors.red('\n✗ Docker is not available'));
            console.log(colors.gray('  Please install Docker to use automated task execution'));
        }
        return;
    }

    // Load task description
    const iterationJsonPath = join(iterationPath, 'iteration.json');
    const iteration = IterationConfig.load(iterationPath);

    // Generate setup script using SetupBuilder
    const setupBuilder = new SetupBuilder(task, selectedAiAgent);
    const setupScriptPath = setupBuilder.generateSetupScript();
    const setupMcpScriptPath = setupBuilder.generateSetupMcpScript();

    // Generate prompts using PromptBuilder
    const promptsDir = join(process.cwd(), '.rover', 'tasks', taskId.toString(), 'iterations', task.iterations.toString(), 'prompts');
    const promptBuilder = new PromptBuilder(selectedAiAgent);
    promptBuilder.generatePromptFiles(iteration, promptsDir);

    // Check AI agent credentials based on selected agent
    let credentialsValid = true;
    const dockerMounts: string[] = [];

    if (selectedAiAgent === 'claude') {
        const claudeFile = join(homedir(), '.claude.json');
        const claudeCreds = join(homedir(), '.claude', '.credentials.json');

        dockerMounts.push(`-v`, `${claudeFile}:/.claude.json:Z,ro`);

        if (existsSync(claudeCreds)) {
            dockerMounts.push(`-v`, `${claudeCreds}:/.credentials.json:Z,ro`);
        } else if (platform == 'darwin') {
            const claudeCreds = findKeychainCredentials('Claude Code-credentials');
            const userCredentialsTempPath = mkdtempSync(join(tmpdir(), 'rover-'));
            const claudeCredsFile = join(userCredentialsTempPath, '.credentials.json');
            writeFileSync(claudeCredsFile, claudeCreds);
            // Do not mount credentials as RO, as they will be
            // shredded by the setup script when it finishes
            dockerMounts.push(`-v`, `${claudeCredsFile}:/.credentials.json:Z`)
        }
    } else if (selectedAiAgent === 'gemini') {
        // Gemini might use environment variables or other auth methods
        const geminiFolder = join(homedir(), '.gemini');

        dockerMounts.push(`-v`, `${geminiFolder}:/.gemini:Z,ro`);
    }

    if (!credentialsValid) {
        return;
    }

    if (!jsonMode) {
        console.log(colors.white.bold('\n🐳 Starting Docker container:'));
        console.log(colors.gray('└── Container Name: ') + colors.white(containerName));
    }

    // Clean up any existing container with same name
    try {
        spawnSync('docker', ['rm', '-f', containerName], { stdio: 'pipe' });
    } catch (error) {
        // Container doesn't exist, which is fine
    }

    if (!jsonMode) {
        console.log('');
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

        const currentUser = userInfo();

        dockerArgs.push(
            '-v', `${worktreePath}:/workspace:Z,rw`,
            '-v', `${iterationPath}:/output:Z,rw`,
            ...dockerMounts,
            '-v', `${setupScriptPath}:/setup.sh:Z,ro`,
            '-v', `${setupMcpScriptPath}:/setup-mcp.sh:Z,ro`,
            '-v', `${iterationJsonPath}:/task/description.json:Z,ro`,
            '-v', `${promptsDir}:/prompts:Z,ro`,
            '-w', '/workspace',
            'node:24-alpine',
            '/bin/sh', '/setup.sh', currentUser.uid.toString(), currentUser.gid.toString()
        );

        if (followMode) {
            if (spinner) spinner.success('Container started');
            if (!jsonMode) {
                console.log(colors.bold.white(`Container logs (--follow)\n`));
            }

            // Start Docker container with streaming output
            if (debug && !jsonMode) {
                console.log(`[DEBUG] docker ${dockerArgs.join(' ')}`);
            }

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
                    spawnSync('docker', ['stop', containerName], { stdio: 'pipe' });
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
                const containerId = spawnSync('docker', dockerArgs, {
                    stdio: 'pipe',
                    encoding: 'utf8'
                }).stdout.toString().trim();

                if (spinner) spinner.success('Container started in background');
                if (!jsonMode) {
                    showTips([
                        'Use ' + colors.cyan(`rover logs -f ${task.id}`) + ` to monitor logs`,
                        'Use ' + colors.cyan(`rover inspect ${task.id}`) + ` to get task details`,
                        'Use ' + colors.cyan(`rover list`) + ` to check the status of all tasks`

                    ]);
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
        const { stdout } = spawnSync(
            'gh', ['issue', 'view', issueNumber.toString(), '--repo', `${owner}/${repo}`, '--json', 'title,body']);
        const issue = JSON.parse(stdout.toString());
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
        const remoteUrl = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout.toString().trim();
        const repoInfo = getGitHubRepoInfo(remoteUrl);

        if (!repoInfo) {
            if (!json) {
                console.log(colors.red('✗ Could not determine GitHub repository from git remote'));
            }
            return null;
        }

        // Try API first
        let issueData = await fetchGitHubIssueViaAPI(repoInfo.owner, repoInfo.repo, issueNumber);

        // If API fails and gh CLI is available, try gh
        const githubCLI = await checkGitHubCLI();

        if (!issueData && githubCLI) {
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
export const taskCommand = async (initPrompt?: string, options: { fromGithub?: string, follow?: boolean, yes?: boolean, json?: boolean, debug?: boolean } = {}) => {
    const telemetry = getTelemetry();
    // Extract options
    const { follow, yes, json, fromGithub, debug } = options;

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
    let selectedAiAgent = AI_AGENT.Claude; // default

    try {
        if (UserSettings.exists()) {
            const userSettings = UserSettings.load();
            selectedAiAgent = userSettings.defaultAiAgent || AI_AGENT.Claude;
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
        showRoverBanner();
        showRoverChat([
            "hey human! Here you can assign new tasks to an agent.",
            "Add detailed instructions for a better result."
        ]);
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

            if (!issueData.body || issueData.body.length == 0) {
                console.error(colors.yellow('GitHub issue description is empty; creating a task with the Github issue title alone: task information might not be accurate'));
            }

            taskData = {
                title: issueData.title,
                description
            }

            if (!json) {
                console.log(colors.green('✓ GitHub issue fetched successfully'));
                console.log(colors.gray('├── Title: ') + colors.cyan(issueData.title));
                console.log(colors.gray('└── Body: ') + colors.white(issueData.body.substring(0, 100) + (issueData.body.length > 100 ? '...' : '')));
            }
        } else {
            // If GitHub fetch failed, exit
            console.error(colors.red('✗ Failed to fetch issue from GitHub'));
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
            message: 'Describe the task you want to assign:',
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
                if (spinner) spinner.success('Done!');
                taskData = expanded;

                // Skip confirmation if using GitHub issue
                if (skipExpansion || yes) {
                    satisfied = true;
                } else {
                    // Display the expanded task
                    if (!json) {
                        console.log('\n' + colors.white.bold('Task Details:'));
                        console.log(colors.gray('├── Title: ') + colors.cyan(taskData.title));
                        console.log(colors.gray('└── Description: ') + colors.white(taskData.description));
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
                            message: 'Provide additional instructions:',
                            validate: (value) => value.trim().length > 0 || 'Please provide additional information'
                        });

                        // Update the description for next iteration
                        taskData.description = `${taskData.description}. Additional instructions: ${additionalInfo}`;
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

        // Setup git worktree and branch
        const worktreePath = join(taskPath, 'workspace');
        const branchName = generateBranchName(taskId);

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
        } catch (error) {
            if (!json) {
                console.error(colors.red('Error creating git workspace:'), error);
            }
            return;
        }


        const iterationPath = join(taskPath, 'iterations', task.iterations.toString());
        mkdirSync(iterationPath, { recursive: true });

        // Create initial iteration.json for the first iteration
        IterationConfig.createInitial(iterationPath, task.id, task.title, task.description);

        // Update task with workspace information
        task.setWorkspace(worktreePath, branchName);
        task.markInProgress();

        if (!json) {
            console.log(colors.bold.white('\n🚀 Task Created'));
            console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
            console.log(colors.gray('├── Title: ') + colors.white(task.title));
            console.log(colors.gray('├── Workspace: ') + colors.cyan(task.worktreePath));
            console.log(colors.gray('└── Branch: ') + colors.cyan(task.branchName));
        }

        // Track new task event
        telemetry?.eventNewTask(options.fromGithub != null ? NewTaskProvider.GITHUB : NewTaskProvider.INPUT);

        // Start Docker container for task execution
        await startDockerExecution(taskId, task, worktreePath, iterationPath, selectedAiAgent, follow, json, debug);

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

    await telemetry?.shutdown();
};
