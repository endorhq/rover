import enquirer from 'enquirer';
import colors from 'ansi-colors';
import yoctoSpinner from 'yocto-spinner';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:process';
import { getNextTaskId } from '../utils/task-id.js';
import { homedir, tmpdir } from 'node:os';
import { getAIAgentTool, type AIAgentTool } from '../lib/agents/index.js';
import type { IPromptTask } from '../lib/prompts/index.js';
import { TaskDescription } from '../lib/description.js';
import { PromptBuilder } from '../lib/prompts/index.js';
import { SetupBuilder } from '../lib/setup.js';
import { UserSettings, AI_AGENT } from '../lib/config.js';
import { IterationConfig } from '../lib/iteration.js';
import { generateBranchName } from '../utils/branch-name.js';
import { request } from 'node:https';
import { spawn } from 'node:child_process';
import { launch, launchSync } from 'rover-common';
import { checkGitHubCLI } from '../utils/system.js';
import { showRoverBanner, showRoverChat, showTips } from '../utils/display.js';
import { userInfo } from 'node:os';
import { getTelemetry } from '../lib/telemetry.js';
import { NewTaskProvider } from 'rover-telemetry';
import { Git } from '../lib/git.js';
import { readFromStdin, stdinIsAvailable } from '../utils/stdin.js';

const { prompt } = enquirer;

/**
 * Command validations.
 */
const validations = (selectedAiAgent?: string, isJsonMode?: boolean, followMode?: boolean): boolean => {
    // Check if we're in a git repository
    try {
        const git = new Git();

        if (!git.isGitRepo()) {
            if (!isJsonMode) {
                console.log(colors.red('✗ Not in a git repository'));
                console.log(colors.gray('  Git worktree requires the project to be in a git repository'));
            }
            return false;
        }

        // Check if git repository has at least one commit
        if (!git.hasCommits()) {
            if (!isJsonMode) {
                console.log(colors.red('✗ No commits found in git repository'));
                console.log(colors.gray('  Git worktree requires at least one commit in the repository'));
            }
            return false;
        }
    } catch (error) {
        if (!isJsonMode) {
            console.log(colors.red('✗ Git repository validation failed'));
            console.log(colors.gray('  Please ensure git is installed and the repository is properly initialized'));
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
    const result = launchSync('security', ['find-generic-password', '-s', key, '-w']).stdout as string;
    if (result === undefined) {
        throw new Error('could not find keychain credentials');
    }
    return result
}

/**
 * Start environment using containers
 */
export const startDockerExecution = async (taskId: number, task: TaskDescription, worktreePath: string, iterationPath: string, selectedAiAgent: string, followMode?: boolean, jsonMode?: boolean, debug?: boolean) => {
    const containerName = `rover-task-${taskId}-${task.iterations}`;

    try {
        // Check if Docker is available
        launchSync('docker', ['--version']);
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
        launchSync('docker', ['rm', '-f', containerName]);
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
                    launchSync('docker', ['stop', containerName]);
                    if (!jsonMode) {
                        console.log(colors.green('✓ Container stopped'));
                    }
                } catch (error) {
                    if (!jsonMode) {
                        console.log(colors.red('✗ Failed to stop container'));
                    }
                }
                // TODO: use exitWithSuccess
                process.exit(0);
            });
        } else {
            // Background mode execution
            try {
                const containerId = launchSync('docker', dockerArgs).stdout?.toString().trim();

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

                // Reset task to NEW status when container fails to start
                updateTaskMetadata(taskId, {
                    status: 'NEW',
                    executionStatus: 'error',
                    error: error.message,
                    errorAt: new Date().toISOString()
                }, jsonMode);

                if (!jsonMode) {
                    console.log(colors.yellow('⚠ There was an error during container creation'));
                    console.log(colors.gray('  Resetting the task status to "New"'));
                    console.log(colors.gray('  Use ') + colors.cyan(`rover start ${taskId}`) + colors.gray(' to retry execution'));
                }

                // TODO: use exitWithError
                process.exit(1);
            }
        }

    } catch (error) {
        if (spinner) spinner.error('Failed to start container');
        if (!jsonMode) {
            console.error(colors.red('Error starting Docker container:'), error);
        }

        // Reset task to NEW status when Docker startup fails
        updateTaskMetadata(taskId, {
            status: 'NEW',
            executionStatus: 'error',
            error: error instanceof Error ? error.message : String(error),
            errorAt: new Date().toISOString()
        }, jsonMode);

        if (!jsonMode) {
            console.log(colors.yellow('⚠ Task reset to NEW status'));
            console.log(colors.gray('  Use ') + colors.cyan(`rover start ${taskId}`) + colors.gray(' to retry execution'));
        }

        // TODO: use exitWithError
        process.exit(1);
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
        const { stdout } = launchSync(
            'gh', ['issue', 'view', issueNumber.toString(), '--repo', `${owner}/${repo}`, '--json', 'title,body']);
        if (!stdout) {
            return null;
        }
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
        const remoteUrl = launchSync('git', ['remote', 'get-url', 'origin']).stdout?.toString().trim();

        if (!remoteUrl) {
            throw new Error('could not get origin remote URL');
        }

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
        // TODO: use exitWithError
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
        // TODO: use exitWithError
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
    let taskData: IPromptTask | null = null;

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
            // TODO: use exitWithError
            process.exit(1);
        }
    }

    // Get initial task description - try stdin first if no description provided
    if (!fromGithub && (typeof description !== 'string' || description.length == 0)) {
        // Try to read from stdin first
        if (stdinIsAvailable()) {
            const stdinInput = await readFromStdin();
            if (stdinInput) {
                description = stdinInput;
                if (!json) {
                    console.log(colors.gray('✓ Read task description from stdin'));
                }
            }
        }

        // If still no description
        if (typeof description !== 'string' || description.length == 0) {
            if (yes) {
                // In non-interactive mode, we must have a description
                if (!json) {
                    console.error(colors.red('✗ Task description is required in non-interactive mode'));
                    console.error(colors.gray('  Please provide a description as an argument: rover task "your task description" --yes'));
                }
                // TODO: use exitWithError
                process.exit(1);
            }

            try {
                const { input } = await prompt<{ input: string }>({
                    type: 'input',
                    name: 'input',
                    message: 'Describe the task you want to assign:',
                    validate: (value) => value.trim().length > 0 || 'Please provide a description'
                });

                description = input;
            } catch (err) {
                console.log(colors.yellow('\n⚠ Task creation cancelled'));
                // TODO: use exitWithError
                process.exit(1);
            }
        }
    }

    let satisfied = skipExpansion;

    while (!satisfied) {
        // Expand task with selected AI provider
        const spinner = !json ? yoctoSpinner({ text: `Expanding task description with ${selectedAiAgent.charAt(0).toUpperCase() + selectedAiAgent.slice(1)}...` }).start() : null;

        try {
            const aiAgent = getAIAgentTool(selectedAiAgent);
            const expanded = await aiAgent.expandTask(
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
                    let confirmValue = 'cancel';
                    try {
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
                        confirmValue = confirm;
                    } catch (err) {
                        // Just cancel it
                        confirmValue = 'cancel';
                    }

                    if (confirmValue === 'yes') {
                        satisfied = true;
                    } else if (confirmValue === 'refine') {
                        // Get additional details
                        try {
                            const { additionalInfo } = await prompt<{ additionalInfo: string }>({
                                type: 'input',
                                name: 'additionalInfo',
                                message: 'Provide additional instructions:',
                                validate: (value) => value.trim().length > 0 || 'Please provide additional information'
                            });

                            // Update the description for next iteration
                            taskData.description = `${taskData.description}. Additional instructions: ${additionalInfo}`;
                        } catch (err) {
                            if (!json) {
                                console.log(colors.yellow('\n⚠ Task creation cancelled'));
                            }
                        }
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
            if (spinner) spinner.error('Failed to expand task. Continuing with original values');

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
            const git = new Git();
            git.createWorktree(worktreePath, branchName);
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
        try {
            await startDockerExecution(taskId, task, worktreePath, iterationPath, selectedAiAgent, follow, json, debug);
        } catch (error) {
            // If Docker execution fails to start, reset task to NEW status
            task.resetToNew();
            if (!json) {
                console.log(colors.yellow('⚠ Task reset to NEW status due to execution failure'));
                console.log(colors.gray('  Use ') + colors.cyan(`rover start ${taskId}`) + colors.gray(' to retry execution'));
            }
            throw error;
        }

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
