import colors from 'ansi-colors';
import enquirer from 'enquirer';
import yoctoSpinner from 'yocto-spinner';
import { spawnSync } from '../lib/os.js';
import { existsSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
const { prompt } = enquirer;

interface PushOptions {
    message?: string;
    pr?: boolean;
    force?: boolean;
    json?: boolean;
}

// Removed TaskData interface - using TaskDescription class instead

/**
 * Check if a command exists
 */
const commandExists = (cmd: string): boolean => {
    try {
        spawnSync('which', [cmd], { stdio: 'pipe' });
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

interface PushResult {
    success: boolean;
    taskId: number;
    taskTitle: string;
    branchName: string;
    hasChanges: boolean;
    committed: boolean;
    commitMessage?: string;
    pushed: boolean;
    pullRequest?: {
        created: boolean;
        url?: string;
        exists?: boolean;
    };
    error?: string;
}

/**
 * Push command implementation
 */
export const pushCommand = async (taskId: string, options: PushOptions) => {
    const result: PushResult = {
        success: false,
        taskId: 0,
        taskTitle: '',
        branchName: '',
        hasChanges: false,
        committed: false,
        pushed: false
    };

    // Convert string taskId to number
    const numericTaskId = parseInt(taskId, 10);
    if (isNaN(numericTaskId)) {
        result.error = `Invalid task ID '${taskId}' - must be a number`;
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(colors.red(`✗ ${result.error}`));
        }
        process.exit(1);
    }

    result.taskId = numericTaskId;

    // Check if rover is initialized
    const roverPath = join(process.cwd(), '.rover');
    if (!existsSync(roverPath)) {
        result.error = 'Rover is not initialized in this directory';
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(colors.red('✗ Rover is not initialized in this directory'));
            console.log(colors.gray('  Run ') + colors.cyan('rover init') + colors.gray(' first'));
        }
        process.exit(1);
    }

    try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);
        result.taskTitle = task.title;
        result.branchName = task.branchName;

        if (!task.worktreePath || !existsSync(task.worktreePath)) {
            result.error = 'Task workspace not found';
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(colors.red(`✗ Task workspace not found`));
                console.log(colors.gray('  The task may need to be reinitialized'));
            }
            process.exit(1);
        }

        if (!options.json) {
            console.log(colors.bold(`\n📤 Pushing changes for task ${numericTaskId}\n`));
        }

        // Change to worktree directory
        process.chdir(task.worktreePath);

        // Check for changes
        const statusOutput = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
        const hasChanges = statusOutput.stdout.toString().trim().length > 0;
        result.hasChanges = hasChanges;

        if (!hasChanges) {
            // Check if there are unpushed commits
            try {
                const unpushedCommits = spawnSync('git', ['rev-list', '--count', `origin/${task.branchName}..${task.branchName}`], {
                    encoding: 'utf8',
                    stdio: ['inherit', 'inherit', 'ignore']
                }).stdout.toString().trim();

                if (unpushedCommits === '0') {
                    result.success = true;
                    if (options.json) {
                        console.log(JSON.stringify(result, null, 2));
                    } else {
                        console.log(colors.yellow('⚠ No changes to push'));
                        console.log(colors.gray('  Working directory is clean and up to date with remote'));
                    }
                    return;
                }
            } catch {
                // Remote branch doesn't exist yet, continue with push
            }
        }

        // If there are changes, commit them
        if (hasChanges) {
            if (!options.json) {
                console.log(colors.cyan('Found uncommitted changes:'));

                // Show brief status
                const files = statusOutput.stdout.toString().trim().split('\n');
                files.forEach(file => {
                    const [status, ...pathParts] = file.trim().split(/\s+/);
                    const path = pathParts.join(' ');
                    const statusSymbol = status.includes('M') ? '±' : status.includes('A') ? '+' : status.includes('D') ? '-' : '?';
                    console.log(colors.gray(`  ${statusSymbol} ${path}`));
                });
            }

            // Get commit message
            let commitMessage = options.message;
            if (!commitMessage) {
                const defaultMessage = `Task ${numericTaskId}: ${task.title}`;
                if (options.json) {
                    commitMessage = defaultMessage;
                } else {
                    const { message } = await prompt<{ message: string }>({
                        type: 'input',
                        name: 'message',
                        message: 'Commit message:',
                        initial: defaultMessage
                    });
                    commitMessage = message;
                }
            }

            result.commitMessage = commitMessage;

            // Stage and commit changes
            const commitSpinner = !options.json ? yoctoSpinner({ text: 'Committing changes...' }).start() : null;
            try {
                spawnSync('git', ['add', '-A'], { stdio: 'pipe' });
                spawnSync('git', ['commit', '-m', commitMessage], { stdio: 'pipe' });
                result.committed = true;
                if (commitSpinner) {
                    commitSpinner.success('Changes committed');
                }
            } catch (error: any) {
                result.error = `Failed to commit changes: ${error.message}`;
                if (options.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    if (commitSpinner) commitSpinner.error('Failed to commit changes');
                    console.error(colors.red('Error:'), error.message);
                }
                process.exit(1);
            }
        }

        // Push to remote
        const pushSpinner = !options.json ? yoctoSpinner({ text: `Pushing branch ${task.branchName} to remote...` }).start() : null;
        try {
            spawnSync('git', ['push', 'origin', task.branchName], { stdio: 'pipe' });
            result.pushed = true;
            if (pushSpinner) {
                pushSpinner.success(`Branch pushed successfully`);
            }
            if (!options.json) {
                console.log(colors.green(`\n✓ Pushed branch: `) + colors.cyan(task.branchName));
            }
        } catch (error: any) {
            if (pushSpinner) {
                pushSpinner.error('Failed to push branch');
            }

            // Check if it's because the remote branch doesn't exist
            if (error.message.includes('has no upstream branch')) {
                if (!options.json) {
                    console.log(colors.yellow('\n⚠ Setting upstream branch and retrying...'));
                }
                try {
                    spawnSync('git', ['push', '--set-upstream', 'origin', task.branchName], { stdio: 'pipe' });
                    result.pushed = true;
                    if (!options.json) {
                        console.log(colors.green(`✓ Branch pushed successfully`));
                    }
                } catch (retryError: any) {
                    result.error = `Failed to push branch: ${retryError.message}`;
                    if (options.json) {
                        console.log(JSON.stringify(result, null, 2));
                    } else {
                        console.error(colors.red('Error:'), retryError.message);
                    }
                    process.exit(1);
                }
            } else {
                result.error = `Failed to push branch: ${error.message}`;
                if (options.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.error(colors.red('Error:'), error.message);
                }
                process.exit(1);
            }
        }

        // Check if this is a GitHub repo
        if (options.pr === true) {
            try {
                const remoteUrl = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout.toString().trim();
                const repoInfo = getGitHubRepoInfo(remoteUrl);

                if (repoInfo) {
                    if (!options.json) {
                        console.log(colors.gray(`\n📍 GitHub repository detected: ${repoInfo.owner}/${repoInfo.repo}`));
                    }

                    // Check if gh CLI is available
                    if (!commandExists('gh')) {
                        result.pullRequest = {
                            created: false
                        };
                        if (!options.json) {
                            console.log(colors.yellow('\n⚠ GitHub CLI (gh) not found'));
                            console.log(colors.gray('  Install it from: https://cli.github.com'));
                            console.log(colors.gray('  Then you can create a PR with: ') +
                                colors.cyan(`gh pr create --title "${task.title}" --body "${task.description}"`));
                        }
                    } else {
                        // Prompt to create PR (skip in JSON mode and auto-create)
                        let createPR = true;
                        if (!options.json) {
                            const response = await prompt<{ createPR: boolean }>({
                                type: 'confirm',
                                name: 'createPR',
                                message: 'Would you like to create a GitHub Pull Request?',
                                initial: true
                            });
                            createPR = response.createPR;
                        }

                        if (createPR) {
                            const prSpinner = !options.json ? yoctoSpinner({ text: 'Creating pull request...' }).start() : null;
                            try {
                                // Create PR with task details
                                const prBody = `## Task ${numericTaskId}\n\n${task.description}\n\n---\n*Created by Rover CLI*`;
                                const { stdout } = spawnSync(
                                    'gh', ['pr', 'create', '--title', task.title, '--body', prBody, '--head', task.branchName]);

                                result.pullRequest = {
                                    created: true,
                                    url: stdout.toString().trim().split('\n').pop()
                                };

                                if (prSpinner) {
                                    prSpinner.success('Pull request created');
                                }

                                if (!options.json) {
                                    console.log(colors.green('\n✓ Pull Request created: ') + colors.cyan(result.pullRequest.url || 'Not available'));
                                }
                            } catch (error: any) {
                                if (prSpinner) {
                                    prSpinner.error('Failed to create pull request');
                                }

                                // Check if PR already exists
                                if (error.message.includes('already exists')) {
                                    result.pullRequest = {
                                        created: false,
                                        exists: true
                                    };

                                    // Try to get existing PR URL
                                    try {
                                        const { stdout } = spawnSync('gh', ['pr', 'view', task.branchName, '--json', 'url', '-q',  '.url']);
                                        result.pullRequest.url = stdout.toString().trim();
                                    } catch {
                                        // Couldn't get PR URL
                                    }

                                    if (!options.json) {
                                        console.log(colors.yellow('⚠ A pull request already exists for this branch'));
                                        if (result.pullRequest.url) {
                                            console.log(colors.gray('  Existing PR: ') + colors.cyan(result.pullRequest.url));
                                        }
                                    }
                                } else {
                                    result.pullRequest = {
                                        created: false
                                    };
                                    if (!options.json) {
                                        console.error(colors.red('Error:'), error.message);
                                        console.log(colors.gray('\n  You can manually create a PR at:'));
                                        console.log(colors.cyan(`  https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/new/${task.branchName}`));
                                    }
                                }
                            }
                        } else {
                            result.pullRequest = {
                                created: false
                            };
                        }
                    }
                }
            } catch (error) {
                // Not a GitHub repo or couldn't determine, skip PR creation
            }
        }

        result.success = true;

        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(colors.green('\n✨ Push completed successfully!'));
        }

    } catch (error: any) {
        if (error instanceof TaskNotFoundError) {
            result.error = error.message;
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(colors.red(`✗ ${error.message}`));
                console.log(colors.gray('  Use ') + colors.cyan('rover list') + colors.gray(' to see available tasks'));
            }
            process.exit(1);
        } else {
            result.error = `Unexpected error: ${error.message}`;
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.error(colors.red('\n✗ Unexpected error:'), error.message);
            }
            process.exit(1);
        }
    }
};
