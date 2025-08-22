import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yoctoSpinner from 'yocto-spinner';
import { getAIAgentTool, type AIAgentTool } from '../lib/agents/index.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { UserSettings, AI_AGENT } from '../lib/config.js';
import { getTelemetry } from '../lib/telemetry.js';
import Git from '../lib/git.js';
import { showRoverChat, showTips } from '../utils/display.js';

const { prompt } = enquirer;

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
 * AI-powered merge conflict resolver
 */
const resolveMergeConflicts = async (git: Git, conflictedFiles: string[], aiAgent: AIAgentTool, json: boolean): Promise<boolean> => {
    let spinner;

    if (!json) {
        spinner = yoctoSpinner({ text: 'Analyzing merge conflicts...' }).start();
    }

    try {
        // Process each conflicted file
        for (const filePath of conflictedFiles) {
            if (spinner) {
                spinner.text = `Resolving conflicts in ${filePath}...`;
            }

            if (!existsSync(filePath)) {
                spinner?.error(`File ${filePath} not found, skipping...`);
                continue;
            }

            // Read the conflicted file
            const conflictedContent = readFileSync(filePath, 'utf8');

            // Get git diff context for better understanding
            const diffContext = git.getRecentCommits({
                branch: git.getCurrentBranch()
            }).join('\n');

            try {
                const resolvedContent = await aiAgent.resolveMergeConflicts(filePath, diffContext, conflictedContent);

                if (!resolvedContent) {
                    spinner?.error(`Failed to resolve conflicts in ${filePath}`);
                    return false;
                }

                // Write the resolved content back to the file
                writeFileSync(filePath, resolvedContent);

                // Stage the resolved file
                if (!git.add(filePath)) {
                    spinner?.error(`Error adding ${filePath} to the git commit`);
                    return false;
                }

            } catch (error) {
                spinner?.error(`Error resolving ${filePath}: ${error}`);
                return false;
            }
        }

        spinner?.success('All conflicts resolved by AI');
        return true;

    } catch (error) {
        spinner?.error('Failed to resolve merge conflicts');
        return false;
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
    const git = new Git();
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
        process.exit(1);
    }

    if (!git.isGitRepo()) {
        result.error = 'No worktree found for this task';
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log('');
            console.log(colors.red('✗ No worktree found for this task'));
            console.log(colors.gray('The task has no workspace to merge.'));
        }
        process.exit(1);
    }

    showRoverChat([
        'We are ready to go',
        "Let's merge the task changes and ship it!"
    ]);

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

        result.taskTitle = task.title;
        result.branchName = task.branchName;

        if (!options.json) {
            console.log(colors.white.bold('Merge Task'));
            console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
            console.log(colors.gray('├── Title: ') + colors.white(task.title));
            console.log(colors.gray('├── Worktree: ') + colors.white(task.worktreePath));
            console.log(colors.gray('├── Branch: ') + colors.white(task.branchName));
            console.log(colors.gray('└── Status: ') + colors.white(task.status));
        }

        if (!task.isCompleted()) {
            console.log(colors.yellow('\nThe task is not completed yet.'))

            showTips([
                'Use ' + colors.cyan(`rover inspect ${numericTaskId}`) + ' to check its status',
                'Use ' + colors.cyan(`rover logs ${numericTaskId}`) + ' to check the logs',
            ]);

            process.exit(1);
        }

        // Check if worktree exists
        if (!task.worktreePath || !existsSync(task.worktreePath)) {
            result.error = 'No worktree found for this task';
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log('');
                console.log(colors.red('✗ No worktree found for this task'));
                console.log(colors.gray('The task has no workspace to merge.'));
            }
            return;
        }

        // Get current branch name
        result.currentBranch = git.getCurrentBranch();

        // Check for uncommitted changes in main repo
        if (git.hasUncommitedChanges()) {
            result.error = 'Current branch has uncommitted changes';
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log('');
                console.log(colors.red('✗ Current branch has uncommitted changes'));
                console.log(colors.gray('  Please commit or stash your changes before merging'));
            }
            return;
        }

        // Check if worktree has changes to commit or if there are unmerged commits
        const hasWorktreeChanges = git.hasUncommitedChanges({ worktreePath: task.worktreePath });
        const taskBranch = task.branchName;
        const hasUnmerged = git.hasUnmergedCommits(taskBranch);

        result.hasWorktreeChanges = hasWorktreeChanges;
        result.hasUnmergedCommits = hasUnmerged;

        if (!hasWorktreeChanges && !hasUnmerged) {
            result.success = true;
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log('');
                console.log(colors.green('✓ No changes to merge'));
                console.log(colors.gray('  The task worktree has no uncommitted changes nor unmerged commits'));
            }
            return;
        }

        if (!options.json) {
            // Show what will happen
            console.log('');
            console.log(colors.cyan('The merge process will'));
            if (hasWorktreeChanges) {
                console.log(colors.cyan('├── Commit changes in the task worktree'));
            }
            console.log(colors.cyan('├── Merge the task branch into the current branch'));
            console.log(colors.cyan('└── Clean up the worktree and branch'));
        }

        // Confirm merge unless force flag is used (skip in JSON mode)
        if (!options.force && !options.json) {
            try {
                const { confirm } = await prompt<{ confirm: boolean }>({
                    type: 'confirm',
                    name: 'confirm',
                    message: 'Do you want to merge this task?',
                    initial: false
                });

                if (!confirm) {
                    result.success = true; // User cancelled, not an error
                    console.log(colors.yellow('\n⚠ Task merge cancelled'));
                    return;
                }
            } catch (err) {
                console.log(colors.yellow('\n⚠ Task merge cancelled'));
                return;
            }
        }

        const spinner = !options.json ? yoctoSpinner({ text: 'Preparing merge...' }).start() : null;

        try {
            // Get recent commit messages for AI context
            if (spinner) spinner.text = 'Gathering commit context...';
            const recentCommits = git.getRecentCommits();

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
                const commitResult = git.addAndCommit(finalCommitMessage, {
                    worktreePath: task.worktreePath
                });

                result.committed = commitResult;

                if (!commitResult) {
                    if (options.json) {
                        throw new Error('Failed to add and commit changes in the workspace');
                    } else {
                        spinner?.error('There was an error adding changes and committing them in the workspace')
                        process.exit(1);
                    }
                }
            }

            if (spinner) spinner.text = 'Merging task branch...';

            // Attempt to merge the task branch
            const taskBranch = task.branchName;
            let mergeSuccessful = false;

            telemetry?.eventMergeTask();

            const merge = git.mergeBranch(taskBranch, `merge: ${task.title}`);

            if (merge) {
                // Update status
                mergeSuccessful = true;
                result.merged = true;

                spinner?.success('Task merged successfully');
            } else {
                // Failed merge! Check if this is a merge conflict
                const mergeConflicts = git.getMergeConflicts();

                if (mergeConflicts.length > 0) {
                    if (spinner) spinner.error('Merge conflicts detected');

                    if (!options.json) {
                        // Print conflicts
                        console.log(colors.yellow(`\n⚠ Merge conflicts detected in ${mergeConflicts.length} file(s):`));
                        mergeConflicts.forEach((file, index) => {
                            const isLast = index === mergeConflicts.length - 1;
                            const connector = isLast ? '└──' : '├──';
                            console.log(colors.gray(connector), colors.white(file));
                        });
                    }

                    // Attempt to fix them with an AI
                    if (!options.json) {
                        showRoverChat([
                            "I noticed some merge conflicts. I will try to solve them"
                        ]);
                    }

                    const resolutionSuccessful = await resolveMergeConflicts(git, mergeConflicts, aiAgent, options.json === true);

                    if (resolutionSuccessful) {
                        result.conflictsResolved = true;

                        if (!options.json) {
                            showRoverChat([
                                "The merge conflicts are fixed. You can check the file content to confirm it."
                            ]);

                            let applyChanges = false;

                            // Ask user to review and confirm
                            try {
                                const { confirmResolution } = await prompt<{ confirmResolution: boolean }>({
                                    type: 'confirm',
                                    name: 'confirmResolution',
                                    message: 'Do you want to continue with the merge?',
                                    initial: false
                                });
                                applyChanges = confirmResolution;
                            } catch (error) {
                                // Ignore the error as it's a regular CTRL+C
                            }

                            if (!applyChanges) {
                                console.log(colors.yellow('\n⚠ User rejected AI resolution. Aborting merge...'));
                                git.abortMerge();
                                return;
                            }
                        }

                        // Complete the merge with the resolved conflicts
                        try {
                            git.continueMerge();

                            mergeSuccessful = true;
                            result.merged = true;

                            if (!options.json) {
                                console.log(colors.green('\n✓ Merge conflicts resolved and merge completed'));
                            }
                        } catch (commitError) {
                            result.error = `Error completing merge after conflict resolution: ${commitError}`;

                            // Cleanup
                            git.abortMerge();

                            if (!options.json) {
                                console.error(colors.red('Error completing merge after conflict resolution:'), commitError);
                            } else {
                                console.log(JSON.stringify(result, null, 2));
                            }

                            process.exit(1);
                        }
                    } else {
                        result.error = 'AI failed to resolve merge conflicts';
                        if (options.json) {
                            console.log(JSON.stringify(result, null, 2));
                        } else {
                            console.log(colors.red('\n✗ AI failed to resolve conflicts. Aborting merge...'));

                            console.log(colors.yellow('\n⚠ Merge aborted due to conflicts.'));
                            console.log(colors.gray('To resolve manually:'));
                            console.log(colors.gray('├──'), colors.gray('1. Fix conflicts in the listed files'));
                            console.log(colors.gray('├──'), colors.gray('2. Run: git add <resolved-files>'));
                            console.log(colors.gray('└──'), colors.gray('3. Run: git merge --continue'));

                            console.log(colors.white('\nIf you prefer to stop the process:'));
                            console.log(colors.cyan(`└── 1. Run: git merge --abort`));
                        }
                        process.exit(1)
                    }
                } else {
                    // Other merge error, not conflicts
                    if (spinner) spinner.error('Merge failed');
                }
            }

            if (mergeSuccessful) {
                result.success = true;

                if (!options.json) {
                    console.log(colors.green('\n✓ Task has been successfully merged into your current branch'));

                    showTips([
                        'Run ' + colors.cyan(`rover del ${numericTaskId}`) + ' to cleanup the workspace, task and git branch.'
                    ])
                }
            }

        } catch (error: any) {
            result.error = `Error during merge: ${error.message}`;
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                if (spinner) spinner.error('Merge failed');
                console.log('');
                console.error(colors.bold.red('✗ Error during merge'));
                console.error(colors.gray('└── ') + error.message)
            }
            process.exit(1);
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
