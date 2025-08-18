import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from '../lib/os.js';
import yoctoSpinner from 'yocto-spinner';
import { getAIAgentTool, type AIAgentTool } from '../lib/agents/index.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { UserSettings, AI_AGENT } from '../lib/config.js';
import { getTelemetry } from '../lib/telemetry.js';

const { prompt } = enquirer;

/**
 * Get the last N commit messages from the main branch
 */
const getRecentCommitMessages = (count: number = 5): string[] => {
    try {
        // Get the main branch name
        let mainBranch = 'main';
        try {
            const remoteHead = spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            }).stdout.toString().trim();
            if (remoteHead) {
                mainBranch = remoteHead.replace('refs/remotes/origin/', '');
            } else {
                // Fallback: check if main or master exists
                try {
                    spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/main'], { stdio: 'pipe' });
                    mainBranch = 'main';
                } catch (error) {
                    try {
                        spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/master'], { stdio: 'pipe' });
                        mainBranch = 'master';
                    } catch (error) {
                        mainBranch = 'main'; // Default fallback
                    }
                }
            }
        } catch (error) {
            mainBranch = 'main';
        }

        // Get recent commit messages from main branch
        const commits = spawnSync('git', ['log', mainBranch, '--pretty', 'format:"%s"', '-n', `${count}`], {
            stdio: 'pipe',
            encoding: 'utf8'
        }).stdout.toString().trim();

        return commits.split('\n').filter(line => line.trim() !== '');

    } catch (error) {
        console.warn(colors.yellow('Warning: Could not retrieve recent commit messages'));
        return [];
    }
};

/**
 * Get summaries from all iterations of a task
 */
const getTaskIterationSummaries = (taskId: string): string[] => {
    try {
        const roverPath = join(process.cwd(), '.rover');
        const taskPath = join(roverPath, 'tasks', taskId);
        const iterationsPath = join(taskPath, 'iterations');

        if (!existsSync(iterationsPath)) {
            return [];
        }

        const iterations = readdirSync(iterationsPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => parseInt(dirent.name, 10))
            .filter(num => !isNaN(num))
            .sort((a, b) => a - b); // Sort ascending

        const summaries: string[] = [];

        for (const iteration of iterations) {
            const iterationPath = join(iterationsPath, iteration.toString());
            const summaryPath = join(iterationPath, 'summary.md');

            if (existsSync(summaryPath)) {
                try {
                    const summary = readFileSync(summaryPath, 'utf8').trim();
                    if (summary) {
                        summaries.push(`Iteration ${iteration}: ${summary}`);
                    }
                } catch (error) {
                    console.warn(colors.yellow(`Warning: Could not read summary for iteration ${iteration}`));
                }
            }
        }

        return summaries;

    } catch (error) {
        console.warn(colors.yellow('Warning: Could not retrieve iteration summaries'));
        return [];
    }
};

/**
 * Generate AI-powered commit message
 */
const generateCommitMessage = async (taskTitle: string, taskDescription: string, recentCommits: string[], summaries: string[], aiAgent: AIAgentTool): Promise<string | null> => {
    try {
        const commitMessage = await aiAgent.generateCommitMessage(
            taskTitle,
            taskDescription,
            recentCommits,
            summaries
        );

        if (commitMessage == null || commitMessage.length === 0) {
            console.warn(colors.yellow('Warning: Could not generate AI commit message'));
        }

        return commitMessage;
    } catch (error) {
        console.warn(colors.yellow('Warning: Could not generate AI commit message'));
        return null;
    }
};

/**
 * Check if the main repository has uncommitted changes
 */
const hasUncommittedChanges = (): boolean => {
    try {
        const status = spawnSync('git', ['status', '--porcelain', '-u', 'no'], {
            stdio: 'pipe',
            encoding: 'utf8'
        }).stdout.toString().trim();

        return status.length > 0;
    } catch (error) {
        return false;
    }
};

/**
 * Check if worktree has changes to commit
 */
const worktreeHasChanges = (worktreePath: string): boolean => {
    try {
        const originalCwd = process.cwd();
        process.chdir(worktreePath);

        const status = spawnSync('git', ['status', '--porcelain'], {
            stdio: 'pipe',
            encoding: 'utf8'
        }).stdout.toString().trim();

        process.chdir(originalCwd);

        return status.length > 0;

    } catch (error) {
        return false;
    }
};

/**
 * Check if task branch has commits that haven't been merged to current branch
 */
const hasUnmergedCommits = (taskBranch: string): boolean => {
    try {
        // Get current branch name
        const currentBranch = spawnSync('git', ['branch', '--show-current'], {
            stdio: 'pipe',
            encoding: 'utf8'
        }).stdout.toString().trim();

        // Check if task branch exists
        try {
            spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${taskBranch}`], { stdio: 'pipe' });
        } catch (error) {
            return false; // Branch doesn't exist
        }

        // Get commits in task branch that are not in current branch
        const unmergedCommits = spawnSync('git', ['log', `${currentBranch}..${taskBranch}`, '--oneline'], {
            stdio: 'pipe',
            encoding: 'utf8'
        }).stdout.toString().trim();

        return unmergedCommits.length > 0;

    } catch (error) {
        return false;
    }
};

/**
 * Get list of unmerged commits for display
 */
const getUnmergedCommits = (taskBranch: string): string[] => {
    try {
        // Get current branch name
        const currentBranch = spawnSync('git', ['branch', '--show-current'], {
            stdio: 'pipe',
            encoding: 'utf8'
        }).stdout.toString().trim();

        // Get commits in task branch that are not in current branch
        const unmergedCommits = spawnSync('git', ['log', `${currentBranch}..${taskBranch}`, '--oneline'], {
            stdio: 'pipe',
            encoding: 'utf8'
        }).stdout.toString().trim();

        return unmergedCommits.split('\n').filter(line => line.trim() !== '');

    } catch (error) {
        return [];
    }
};

/**
 * Check if there are merge conflicts
 */
const hasMergeConflicts = (): boolean => {
    try {
        // Check if we're in a merge state
        const status = spawnSync('git', ['status', '--porcelain'], {
            stdio: 'pipe',
            encoding: 'utf8'
        }).stdout.toString().trim();

        // Look for conflict markers (UU, AA, etc.)
        const conflictLines = status.split('\n').filter(line =>
            line.startsWith('UU ') || line.startsWith('AA ') ||
            line.startsWith('DD ') || line.startsWith('AU ') ||
            line.startsWith('UA ') || line.startsWith('DU ') ||
            line.startsWith('UD ')
        );

        return conflictLines.length > 0;

    } catch (error) {
        return false;
    }
};

/**
 * Get list of files with merge conflicts
 */
const getConflictedFiles = (): string[] => {
    try {
        const status = spawnSync('git', ['status', '--porcelain'], {
            stdio: 'pipe',
            encoding: 'utf8'
        }).stdout.toString().trim();

        const conflictFiles = status.split('\n')
            .filter(line =>
                line.startsWith('UU ') || line.startsWith('AA ') ||
                line.startsWith('DD ') || line.startsWith('AU ') ||
                line.startsWith('UA ') || line.startsWith('DU ') ||
                line.startsWith('UD ')
            )
            .map(line => line.substring(3).trim());

        return conflictFiles;

    } catch (error) {
        return [];
    }
};

/**
 * AI-powered merge conflict resolver
 */
const resolveMergeConflicts = async (conflictedFiles: string[], aiAgent: AIAgentTool): Promise<boolean> => {
    const spinner = yoctoSpinner({ text: 'Analyzing merge conflicts...' }).start();

    try {
        // Process each conflicted file
        for (const filePath of conflictedFiles) {
            spinner.text = `Resolving conflicts in ${filePath}...`;

            if (!existsSync(filePath)) {
                spinner.error(`File ${filePath} not found, skipping...`);
                continue;
            }

            // Read the conflicted file
            const conflictedContent = readFileSync(filePath, 'utf8');

            // Get git diff context for better understanding
            let diffContext = '';
            try {
                diffContext = spawnSync('git', ['log', '--oneline', '-10'], {
                    stdio: 'pipe',
                    encoding: 'utf8'
                }).stdout.toString();
            } catch (error) {
                diffContext = 'No recent commit history available';
            }

            try {
                const resolvedContent = await aiAgent.resolveMergeConflicts(filePath, diffContext, conflictedContent);

                if (!resolvedContent) {
                    spinner.error(`Failed to resolve conflicts in ${filePath}`);
                    return false;
                }

                // Write the resolved content back to the file
                writeFileSync(filePath, resolvedContent);

                // Stage the resolved file
                spawnSync('git', ['add', filePath], { stdio: 'pipe' });

            } catch (error) {
                spinner.error(`Error resolving ${filePath}: ${error}`);
                return false;
            }
        }

        spinner.success('All conflicts resolved by AI');
        return true;

    } catch (error) {
        spinner.error('Failed to resolve merge conflicts');
        console.error(colors.red('Error during conflict resolution:'), error);
        return false;
    }
};

/**
 * Show resolved changes for user review
 */
const showResolvedChanges = async (conflictedFiles: string[]): Promise<void> => {
    console.log(colors.bold('\n📋 AI-Resolved Changes:\n'));

    for (const filePath of conflictedFiles) {
        console.log(colors.cyan(`📄 ${filePath}:`));

        try {
            // Show the diff of what was resolved
            const diff = spawnSync('git', ['diff', '--cached', filePath], {
                stdio: 'pipe',
                encoding: 'utf8'
            }).stdout.toString();

            if (diff.trim()) {
                console.log(colors.gray(diff));
            } else {
                console.log(colors.yellow('  No staged changes visible'));
            }
        } catch (error) {
            console.log(colors.red(`  Error showing diff for ${filePath}`));
        }

        console.log(''); // Add spacing between files
    }
};

interface MergeOptions {
    force?: boolean;
    json?: boolean;
}

interface MergeResult {
    success: boolean;
    taskId: number;
    taskTitle: string;
    branchName: string;
    currentBranch: string;
    hasWorktreeChanges: boolean;
    hasUnmergedCommits: boolean;
    committed: boolean;
    commitMessage?: string;
    merged: boolean;
    conflictsResolved?: boolean;
    cleanedUp?: boolean;
    error?: string;
}

export const mergeCommand = async (taskId: string, options: MergeOptions = {}) => {
    const telemetry = getTelemetry();
    const result: MergeResult = {
        success: false,
        taskId: 0,
        taskTitle: '',
        branchName: '',
        currentBranch: '',
        hasWorktreeChanges: false,
        hasUnmergedCommits: false,
        committed: false,
        merged: false
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
        return;
    }

    result.taskId = numericTaskId;

    // Load AI agent selection from user settings
    let selectedAiAgent = 'claude'; // default

    try {
        if (UserSettings.exists()) {
            const userSettings = UserSettings.load();
            selectedAiAgent = userSettings.defaultAiAgent || AI_AGENT.Claude;
        } else {
            if (!options.json) {
                console.log(colors.yellow('⚠ User settings not found, defaulting to Claude'));
                console.log(colors.gray('  Run `rover init` to configure AI agent preferences'));
            }
        }
    } catch (error) {
        if (!options.json) {
            console.log(colors.yellow('⚠ Could not load user settings, defaulting to Claude'));
        }
        selectedAiAgent = AI_AGENT.Claude;
    }

    // Create AI agent instance
    const aiAgent = getAIAgentTool(selectedAiAgent);

    try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);
        const taskPath = join(process.cwd(), '.rover', 'tasks', numericTaskId.toString());

        result.taskTitle = task.title;
        result.branchName = task.branchName;

        if (!options.json) {
            console.log(colors.bold('\n🔄 Merge Task\n'));
            console.log(colors.gray('ID: ') + colors.cyan(task.id.toString()));
            console.log(colors.gray('Title: ') + colors.white(task.title));
            console.log(colors.gray('Status: ') + colors.yellow(task.status));
        }

        // Check if worktree exists
        if (!task.worktreePath || !existsSync(task.worktreePath)) {
            result.error = 'No worktree found for this task';
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log('');
                console.log(colors.red('✗ No worktree found for this task'));
                console.log(colors.gray('  Run ') + colors.cyan(`rover task ${numericTaskId}`) + colors.gray(' first'));
            }
            return;
        }

        if (!options.json) {
            console.log(colors.gray('Worktree: ') + colors.cyan(task.worktreePath));
            console.log(colors.gray('Branch: ') + colors.cyan(task.branchName));
        }

        // Check if we're in a git repository
        try {
            spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
        } catch (error) {
            result.error = 'Not in a git repository';
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log('')
                console.log(colors.red('✗ Not in a git repository'));
            }
            return;
        }

        // Get current branch name
        try {
            result.currentBranch = spawnSync('git', ['branch', '--show-current'], {
                stdio: 'pipe',
                encoding: 'utf8'
            }).stdout.toString().trim();
        } catch (error) {
            result.currentBranch = 'unknown';
        }

        // Check for uncommitted changes in main repo
        if (hasUncommittedChanges()) {
            result.error = 'Main repository has uncommitted changes';
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log('');
                console.log(colors.red('✗ Main repository has uncommitted changes'));
                console.log(colors.gray('  Please commit or stash your changes before merging'));
            }
            return;
        }

        // Check if worktree has changes to commit or if there are unmerged commits
        const hasWorktreeChanges = worktreeHasChanges(task.worktreePath);
        const taskBranch = task.branchName;
        const hasUnmerged = hasUnmergedCommits(taskBranch);

        result.hasWorktreeChanges = hasWorktreeChanges;
        result.hasUnmergedCommits = hasUnmerged;

        if (!hasWorktreeChanges && !hasUnmerged) {
            result.success = true;
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log('');
                console.log(colors.yellow('⚠ No changes to merge'));
                console.log(colors.gray('  The task worktree has no uncommitted changes'));
                console.log(colors.gray('  The task branch has no unmerged commits'));
            }
            return;
        }

        if (!options.json) {
            // Show what's ready to merge
            console.log('');
            if (hasWorktreeChanges) {
                console.log(colors.green('✓ Worktree has uncommitted changes ready to commit'));
            }
            if (hasUnmerged) {
                const unmergedCommits = getUnmergedCommits(taskBranch);
                console.log(colors.green(`✓ Task branch has ${unmergedCommits.length} unmerged commit(s):`));
                unmergedCommits.forEach(commit => {
                    console.log(colors.gray(`  ${commit}`));
                });
            }

            // Show what will happen
            console.log('');
            console.log(colors.cyan('This will:'));
            if (hasWorktreeChanges) {
                console.log(colors.cyan('  • Commit changes in the task worktree'));
                console.log(colors.cyan('  • Generate an AI-powered commit message'));
            }
            console.log(colors.cyan('  • Merge the task branch into the current branch'));
            console.log(colors.cyan('  • Clean up the worktree and branch'));
        }

        // Confirm merge unless force flag is used (skip in JSON mode)
        if (!options.force && !options.json) {
            const { confirm } = await prompt<{ confirm: boolean }>({
                type: 'confirm',
                name: 'confirm',
                message: 'Are you sure you want to merge this task?',
                initial: false
            });

            if (!confirm) {
                result.success = true; // User cancelled, not an error
                console.log(colors.yellow('\n⚠ Task merge cancelled'));
                return;
            }
        }

        const spinner = !options.json ? yoctoSpinner({ text: 'Preparing merge...' }).start() : null;

        try {
            // Get recent commit messages for AI context
            if (spinner) spinner.text = 'Gathering commit context...';
            const recentCommits = getRecentCommitMessages(5);

            let finalCommitMessage = '';

            // Only commit if there are worktree changes
            if (hasWorktreeChanges) {
                // Get iteration summaries
                const summaries = getTaskIterationSummaries(numericTaskId.toString());

                // Generate AI commit message
                if (spinner) spinner.text = 'Generating commit message with AI...';
                const aiCommitMessage = await generateCommitMessage(
                    task.title,
                    task.description,
                    recentCommits,
                    summaries,
                    aiAgent
                );

                // Fallback commit message if AI fails
                const commitMessage = aiCommitMessage || `${task.title}\n\n${task.description}`;

                // Add Co-Authored-By line
                finalCommitMessage = `${commitMessage}\n\nCo-Authored-By: Rover <noreply@endor.dev>`;
                result.commitMessage = finalCommitMessage.split('\n')[0]; // Store first line for result

                if (spinner) spinner.text = 'Committing changes in worktree...';

                // Switch to worktree and commit changes
                const originalCwd = process.cwd();
                process.chdir(task.worktreePath);
                
                telemetry?.eventMergeTask();

                try {
                    // Add all changes
                    spawnSync('git', ['add', '.'], { stdio: 'pipe' });

                    // Create commit with the generated message
                    spawnSync('git', ['commit', '-m', finalCommitMessage], {
                        stdio: 'pipe'
                    });

                    result.committed = true;

                    // Switch back to original directory
                    process.chdir(originalCwd);

                } catch (commitError) {
                    process.chdir(originalCwd);
                    throw commitError;
                }
            }

            if (spinner) spinner.text = 'Merging task branch...';

            // Attempt to merge the task branch
            const taskBranch = task.branchName;
            let mergeSuccessful = false;

            try {
                spawnSync('git', ['merge', '--no-ff', taskBranch, '-m', `merge: ${task.title}`], {
                    stdio: 'pipe'
                });
                mergeSuccessful = true;
                result.merged = true;
                if (spinner) spinner.success('Task merged successfully');

            } catch (mergeError) {
                // Check if this is a merge conflict
                if (hasMergeConflicts()) {
                    if (spinner) spinner.error('Merge conflicts detected');

                    const conflictedFiles = getConflictedFiles();

                    if (!options.json) {
                        console.log(colors.yellow(`\n⚠ Merge conflicts detected in ${conflictedFiles.length} file(s):`));
                        conflictedFiles.forEach(file => {
                            console.log(colors.red(`  • ${file}`));
                        });
                    }

                    // In JSON mode, always attempt AI resolution automatically
                    let useAI = options.json;
                    if (!options.json) {
                        // Ask user if they want AI to resolve conflicts
                        const response = await prompt<{ useAI: boolean }>({
                            type: 'confirm',
                            name: 'useAI',
                            message: 'Would you like AI to automatically resolve these merge conflicts?',
                            initial: true
                        });
                        useAI = response.useAI;
                    }

                    if (useAI) {
                        if (!options.json) {
                            console.log(colors.cyan('\n🤖 Starting AI-powered conflict resolution...\n'));
                        }

                        const resolutionSuccessful = await resolveMergeConflicts(conflictedFiles, aiAgent);

                        if (resolutionSuccessful) {
                            result.conflictsResolved = true;

                            if (!options.json) {
                                // Show what was resolved
                                await showResolvedChanges(conflictedFiles);

                                // Ask user to review and confirm
                                const { confirmResolution } = await prompt<{ confirmResolution: boolean }>({
                                    type: 'confirm',
                                    name: 'confirmResolution',
                                    message: 'Do you approve these AI-resolved changes?',
                                    initial: false
                                });

                                if (!confirmResolution) {
                                    console.log(colors.yellow('\n⚠ User rejected AI resolution. Aborting merge...'));
                                    try {
                                        spawnSync('git', ['merge', '--abort'], { stdio: 'pipe' });
                                    } catch (abortError) {
                                        // Ignore abort errors
                                    }
                                    console.log(colors.gray('You can resolve conflicts manually and run the merge command again.'));
                                    return;
                                }
                            }

                            // Complete the merge with the resolved conflicts
                            try {
                                spawnSync('git', ['commit', '--no-edit'], { stdio: 'pipe' });
                                mergeSuccessful = true;
                                result.merged = true;
                                if (!options.json) {
                                    console.log(colors.green('\n✓ Merge conflicts resolved and merge completed'));
                                }
                            } catch (commitError) {
                                result.error = `Error completing merge after conflict resolution: ${commitError}`;
                                if (!options.json) {
                                    console.error(colors.red('Error completing merge after conflict resolution:'), commitError);
                                }
                                // Abort the merge to clean state
                                try {
                                    spawnSync('git', ['merge', '--abort'], { stdio: 'pipe' });
                                } catch (abortError) {
                                    // Ignore abort errors
                                }
                                throw commitError;
                            }
                        } else {
                            result.error = 'AI failed to resolve merge conflicts';
                            if (options.json) {
                                console.log(JSON.stringify(result, null, 2));
                            } else {
                                console.log(colors.red('\n✗ AI failed to resolve conflicts. Aborting merge...'));
                                console.log(colors.gray('You can resolve conflicts manually and run the merge command again.'));
                            }
                            try {
                                spawnSync('git', ['merge', '--abort'], { stdio: 'pipe' });
                            } catch (abortError) {
                                // Ignore abort errors
                            }
                            return;
                        }
                    } else {
                        result.error = 'Merge aborted due to conflicts';
                        if (options.json) {
                            console.log(JSON.stringify(result, null, 2));
                        } else {
                            console.log(colors.yellow('\n⚠ Merge aborted due to conflicts.'));
                            console.log(colors.gray('To resolve manually:'));
                            console.log(colors.cyan('  1. Fix conflicts in the listed files'));
                            console.log(colors.cyan('  2. Run: git add <resolved-files>'));
                            console.log(colors.cyan('  3. Run: git commit'));
                            console.log(colors.cyan(`  4. Run: rover merge ${taskId} to complete the process`));
                        }
                        try {
                            spawnSync('git', ['merge', '--abort'], { stdio: 'pipe' });
                        } catch (abortError) {
                            // Ignore abort errors
                        }
                        return;
                    }
                } else {
                    // Other merge error, not conflicts
                    if (spinner) spinner.error('Merge failed');
                    throw mergeError;
                }
            }

            if (mergeSuccessful) {
                result.success = true;

                if (!options.json) {
                    console.log(colors.green('\n✓ Task has been successfully merged'));
                    if (hasWorktreeChanges && finalCommitMessage) {
                        // Extract just the first line for display
                        const displayMessage = finalCommitMessage.split('\n')[0];
                        console.log(colors.gray('  New commit: ') + colors.white(displayMessage));
                    }
                    if (hasUnmerged) {
                        const unmergedCount = getUnmergedCommits(taskBranch).length;
                        console.log(colors.gray(`  Merged ${unmergedCount} existing commit(s) from task branch`));
                    }
                    console.log(colors.gray('  Merged into: ') + colors.cyan(result.currentBranch));
                }

                // Ask if user wants to clean up worktree and branch (auto-cleanup in JSON mode)
                let shouldCleanup = options.json; // Auto-cleanup in JSON mode
                if (!options.json) {
                    const { cleanup } = await prompt<{ cleanup: boolean }>({
                        type: 'confirm',
                        name: 'cleanup',
                        message: 'Clean up worktree and branch?',
                        initial: true
                    });
                    shouldCleanup = cleanup;
                }

                if (shouldCleanup) {
                    const cleanupSpinner = !options.json ? yoctoSpinner({ text: 'Cleaning up...' }).start() : null;

                    try {
                        // Remove worktree
                        spawnSync('git', ['worktree', 'remove', task.worktreePath, '--force'], { stdio: 'pipe' });

                        // Delete branch
                        spawnSync('git', ['branch', '-d', taskBranch], { stdio: 'pipe' });

                        result.cleanedUp = true;
                        if (cleanupSpinner) {
                            cleanupSpinner.success('Cleanup completed');
                        }
                        if (!options.json) {
                            console.log(colors.green('✓ Worktree and branch cleaned up'));
                        }

                    } catch (cleanupError) {
                        if (cleanupSpinner) {
                            cleanupSpinner.error('Cleanup failed');
                        }
                        if (!options.json) {
                            console.warn(colors.yellow('Warning: Could not clean up worktree/branch automatically'));
                            console.log(colors.gray('  You may need to clean up manually:'));
                            console.log(colors.cyan(`    git worktree remove "${task.worktreePath}" --force`));
                            console.log(colors.cyan(`    git branch -d "${taskBranch}"`));
                        }
                    }
                }
            }

        } catch (error: any) {
            result.error = `Error during merge: ${error.message}`;
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                if (spinner) spinner.error('Merge failed');
                console.log('');
                console.error(colors.red('Error during merge:'), error.message);
                console.log(colors.gray('The repository state has been preserved.'));
            }
            return;
        }

        // Output final result
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        }

    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            result.error = error.message;
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(colors.red(`✗ ${error.message}`));
            }
        } else {
            result.error = `Error merging task: ${error}`;
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.error(colors.red('Error merging task:'), error);
            }
        }
    } finally {
        await telemetry?.shutdown();
    }
};
