import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import yoctoSpinner from 'yocto-spinner';
import { GeminiAI } from '../utils/gemini.js';

const { prompt } = enquirer;

/**
 * Get the last N commit messages from the main branch
 */
const getRecentCommitMessages = (count: number = 5): string[] => {
    try {
        // Get the main branch name
        let mainBranch = 'main';
        try {
            const remoteHead = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo ""', { 
                stdio: 'pipe', 
                encoding: 'utf8' 
            }).trim();
            if (remoteHead) {
                mainBranch = remoteHead.replace('refs/remotes/origin/', '');
            } else {
                // Fallback: check if main or master exists
                try {
                    execSync('git show-ref --verify --quiet refs/heads/main', { stdio: 'pipe' });
                    mainBranch = 'main';
                } catch (error) {
                    try {
                        execSync('git show-ref --verify --quiet refs/heads/master', { stdio: 'pipe' });
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
        const commits = execSync(`git log ${mainBranch} --pretty=format:"%s" -n ${count}`, {
            stdio: 'pipe',
            encoding: 'utf8'
        }).trim();
        
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
const generateCommitMessage = async (taskTitle: string, taskDescription: string, recentCommits: string[], summaries: string[]): Promise<string | null> => {
    try {
        let prompt = `You are a git commit message generator. Generate a concise, clear commit message for the following task completion.

Task Title: ${taskTitle}
Task Description: ${taskDescription}

`;

        if (recentCommits.length > 0) {
            prompt += `Recent commit messages for context (to match style):
${recentCommits.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}

`;
        }

        if (summaries.length > 0) {
            prompt += `Work completed across iterations:
${summaries.join('\n')}

`;
        }

        prompt += `Generate a commit message that:
1. Follows conventional commit format if the recent commits do (feat:, fix:, chore:, etc.)
2. Is concise but descriptive (under 72 characters for the first line)
3. Captures the essence of what was accomplished
4. Matches the style/tone of recent commits

Return ONLY the commit message text, nothing else.`;

        const response = await GeminiAI.invoke(prompt);
        
        if (!response) {
            return null;
        }
        
        // Clean up the response to get just the commit message
        const lines = response.split('\n').filter((line: string) => line.trim() !== '');
        return lines[0] || null;
        
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
        const status = execSync('git status --porcelain -u no', {
            stdio: 'pipe',
            encoding: 'utf8'
        }).trim();
        
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
        
        const status = execSync('git status --porcelain', {
            stdio: 'pipe',
            encoding: 'utf8'
        }).trim();
        
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
        const currentBranch = execSync('git branch --show-current', {
            stdio: 'pipe',
            encoding: 'utf8'
        }).trim();
        
        // Check if task branch exists
        try {
            execSync(`git show-ref --verify --quiet refs/heads/${taskBranch}`, { stdio: 'pipe' });
        } catch (error) {
            return false; // Branch doesn't exist
        }
        
        // Get commits in task branch that are not in current branch
        const unmergedCommits = execSync(`git log ${currentBranch}..${taskBranch} --oneline`, {
            stdio: 'pipe',
            encoding: 'utf8'
        }).trim();
        
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
        const currentBranch = execSync('git branch --show-current', {
            stdio: 'pipe',
            encoding: 'utf8'
        }).trim();
        
        // Get commits in task branch that are not in current branch
        const unmergedCommits = execSync(`git log ${currentBranch}..${taskBranch} --oneline`, {
            stdio: 'pipe',
            encoding: 'utf8'
        }).trim();
        
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
        const status = execSync('git status --porcelain', {
            stdio: 'pipe',
            encoding: 'utf8'
        }).trim();
        
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
        const status = execSync('git status --porcelain', {
            stdio: 'pipe',
            encoding: 'utf8'
        }).trim();
        
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
const resolveMergeConflicts = async (conflictedFiles: string[]): Promise<boolean> => {
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
                diffContext = execSync(`git log --oneline -10`, {
                    stdio: 'pipe',
                    encoding: 'utf8'
                });
            } catch (error) {
                diffContext = 'No recent commit history available';
            }
            
            // Create AI prompt for conflict resolution
            const prompt = `You are an expert software engineer tasked with resolving Git merge conflicts. 
            
Analyze the following conflicted file and resolve the merge conflicts by choosing the best combination of changes from both sides or creating a solution that integrates both changes appropriately.

File: ${filePath}

Recent commit history for context:
${diffContext}

Conflicted file content:
\`\`\`
${conflictedContent}
\`\`\`

Please provide the resolved file content with:
1. All conflict markers (<<<<<<< HEAD, =======, >>>>>>> branch) removed
2. The best combination of changes from both sides
3. Proper code formatting and syntax
4. Logical integration of conflicting changes when possible

Respond with ONLY the resolved file content, no explanations or markdown formatting.`;

            try {
                const resolvedContent = await GeminiAI.invoke(prompt);
                
                if (!resolvedContent) {
                    spinner.error(`Failed to resolve conflicts in ${filePath}`);
                    return false;
                }
                
                // Write the resolved content back to the file
                writeFileSync(filePath, resolvedContent);
                
                // Stage the resolved file
                execSync(`git add "${filePath}"`, { stdio: 'pipe' });
                
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
            const diff = execSync(`git diff --cached "${filePath}"`, {
                stdio: 'pipe',
                encoding: 'utf8'
            });
            
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

export const mergeCommand = async (taskId: string, options: { force?: boolean } = {}) => {
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
        
        console.log(colors.bold('\n🔄 Merge Task\n'));
        console.log(colors.gray('ID: ') + colors.cyan(taskId));
        console.log(colors.gray('Title: ') + colors.white(taskData.title));
        console.log(colors.gray('Status: ') + colors.yellow(taskData.status));
        
        // Check if worktree exists
        const worktreePath = join(taskPath, 'workspace');
        if (!worktreePath || !existsSync(worktreePath)) {
            console.log('');
            console.log(colors.red('✗ No worktree found for this task'));
            console.log(colors.gray('  Run ') + colors.cyan(`rover task ${taskId}`) + colors.gray(' first'));
            return;
        }
        
        console.log(colors.gray('Worktree: ') + colors.cyan(worktreePath));
        console.log(colors.gray('Branch: ') + colors.cyan(taskData.branchName || `task-${taskId}`));
        
        // Check if we're in a git repository
        try {
            execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
        } catch (error) {
            console.log('')
            console.log(colors.red('✗ Not in a git repository'));
            return;
        }
        
        // Check for uncommitted changes in main repo
        if (hasUncommittedChanges()) {
            console.log('');
            console.log(colors.red('✗ Main repository has uncommitted changes'));
            console.log(colors.gray('  Please commit or stash your changes before merging'));
            return;
        }
        
        // Check if worktree has changes to commit or if there are unmerged commits
        const hasWorktreeChanges = worktreeHasChanges(worktreePath);
        const taskBranch = taskData.branchName || `task-${taskId}`;
        const hasUnmerged = hasUnmergedCommits(taskBranch);
        
        if (!hasWorktreeChanges && !hasUnmerged) {
            console.log('');
            console.log(colors.yellow('⚠ No changes to merge'));
            console.log(colors.gray('  The task worktree has no uncommitted changes'));
            console.log(colors.gray('  The task branch has no unmerged commits'));
            return;
        }
        
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
        
        // Confirm merge unless force flag is used
        if (!options.force) {
            const { confirm } = await prompt<{ confirm: boolean }>({
                type: 'confirm',
                name: 'confirm',
                message: 'Are you sure you want to merge this task?',
                initial: false
            });
            
            if (!confirm) {
                console.log(colors.yellow('\n⚠ Task merge cancelled'));
                return;
            }
        }
        
        const spinner = yoctoSpinner({ text: 'Preparing merge...' }).start();
        
        try {
            // Get current branch name
            const currentBranch = execSync('git branch --show-current', {
                stdio: 'pipe',
                encoding: 'utf8'
            }).trim();
            
            // Get recent commit messages for AI context
            spinner.text = 'Gathering commit context...';
            const recentCommits = getRecentCommitMessages(5);
            
            let finalCommitMessage = '';
            
            // Only commit if there are worktree changes
            if (hasWorktreeChanges) {
                // Get iteration summaries
                const summaries = getTaskIterationSummaries(taskId);
                
                // Generate AI commit message
                spinner.text = 'Generating commit message with AI...';
                const aiCommitMessage = await generateCommitMessage(
                    taskData.title,
                    taskData.description,
                    recentCommits,
                    summaries
                );
                
                // Fallback commit message if AI fails
                const commitMessage = aiCommitMessage || `${taskData.title}\n\n${taskData.description}`;
                
                // Add Co-Authored-By line
                finalCommitMessage = `${commitMessage}\n\nCo-Authored-By: Rover <noreply@endor.dev>`;
                
                spinner.text = 'Committing changes in worktree...';
                
                // Switch to worktree and commit changes
                const originalCwd = process.cwd();
                process.chdir(worktreePath);
                
                try {
                    // Add all changes
                    execSync('git add .', { stdio: 'pipe' });
                    
                    // Create commit with the generated message
                    execSync(`git commit -m "${finalCommitMessage.replace(/"/g, '\\\\"')}"`, {
                        stdio: 'pipe'
                    });
                    
                    // Switch back to original directory
                    process.chdir(originalCwd);
                    
                } catch (commitError) {
                    process.chdir(originalCwd);
                    throw commitError;
                }
            }
            
            spinner.text = 'Merging task branch...';
            
            // Attempt to merge the task branch
            const taskBranch = taskData.branchName || `task-${taskId}`;
            let mergeSuccessful = false;
            
            try {
                execSync(`git merge --no-ff ${taskBranch} -m "Merge task: ${taskData.title}"`, {
                    stdio: 'pipe'
                });
                mergeSuccessful = true;
                spinner.success('Task merged successfully');
                
            } catch (mergeError) {
                // Check if this is a merge conflict
                if (hasMergeConflicts()) {
                    spinner.error('Merge conflicts detected');
                    
                    const conflictedFiles = getConflictedFiles();
                    console.log(colors.yellow(`\n⚠ Merge conflicts detected in ${conflictedFiles.length} file(s):`));
                    conflictedFiles.forEach(file => {
                        console.log(colors.red(`  • ${file}`));
                    });
                    
                    // Ask user if they want AI to resolve conflicts
                    const { useAI } = await prompt<{ useAI: boolean }>({
                        type: 'confirm',
                        name: 'useAI',
                        message: 'Would you like AI to automatically resolve these merge conflicts?',
                        initial: true
                    });
                    
                    if (useAI) {
                        console.log(colors.cyan('\n🤖 Starting AI-powered conflict resolution...\n'));
                        
                        const resolutionSuccessful = await resolveMergeConflicts(conflictedFiles);
                        
                        if (resolutionSuccessful) {
                            // Show what was resolved
                            await showResolvedChanges(conflictedFiles);
                            
                            // Ask user to review and confirm
                            const { confirmResolution } = await prompt<{ confirmResolution: boolean }>({
                                type: 'confirm',
                                name: 'confirmResolution',
                                message: 'Do you approve these AI-resolved changes?',
                                initial: false
                            });
                            
                            if (confirmResolution) {
                                // Complete the merge with the resolved conflicts
                                try {
                                    execSync('git commit --no-edit', { stdio: 'pipe' });
                                    mergeSuccessful = true;
                                    console.log(colors.green('\n✓ Merge conflicts resolved and merge completed'));
                                } catch (commitError) {
                                    console.error(colors.red('Error completing merge after conflict resolution:'), commitError);
                                    // Abort the merge to clean state
                                    try {
                                        execSync('git merge --abort', { stdio: 'pipe' });
                                    } catch (abortError) {
                                        // Ignore abort errors
                                    }
                                    throw commitError;
                                }
                            } else {
                                console.log(colors.yellow('\n⚠ User rejected AI resolution. Aborting merge...'));
                                try {
                                    execSync('git merge --abort', { stdio: 'pipe' });
                                } catch (abortError) {
                                    // Ignore abort errors
                                }
                                console.log(colors.gray('You can resolve conflicts manually and run the merge command again.'));
                                return;
                            }
                        } else {
                            console.log(colors.red('\n✗ AI failed to resolve conflicts. Aborting merge...'));
                            try {
                                execSync('git merge --abort', { stdio: 'pipe' });
                            } catch (abortError) {
                                // Ignore abort errors
                            }
                            console.log(colors.gray('You can resolve conflicts manually and run the merge command again.'));
                            return;
                        }
                    } else {
                        console.log(colors.yellow('\n⚠ Merge aborted due to conflicts.'));
                        console.log(colors.gray('To resolve manually:'));
                        console.log(colors.cyan('  1. Fix conflicts in the listed files'));
                        console.log(colors.cyan('  2. Run: git add <resolved-files>'));
                        console.log(colors.cyan('  3. Run: git commit'));
                        console.log(colors.cyan(`  4. Run: rover merge ${taskId} to complete the process`));
                        try {
                            execSync('git merge --abort', { stdio: 'pipe' });
                        } catch (abortError) {
                            // Ignore abort errors
                        }
                        return;
                    }
                } else {
                    // Other merge error, not conflicts
                    spinner.error('Merge failed');
                    throw mergeError;
                }
            }
            
            if (mergeSuccessful) {
                
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
                console.log(colors.gray('  Merged into: ') + colors.cyan(currentBranch));
                
                // Ask if user wants to clean up worktree and branch
                const { cleanup } = await prompt<{ cleanup: boolean }>({
                    type: 'confirm',
                    name: 'cleanup',
                    message: 'Clean up worktree and branch?',
                    initial: true
                });
                
                if (cleanup) {
                    const cleanupSpinner = yoctoSpinner({ text: 'Cleaning up...' }).start();
                    
                    try {
                        // Remove worktree
                        execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'pipe' });
                        
                        // Delete branch
                        execSync(`git branch -d "${taskBranch}"`, { stdio: 'pipe' });
                        
                        cleanupSpinner.success('Cleanup completed');
                        console.log(colors.green('✓ Worktree and branch cleaned up'));
                        
                    } catch (cleanupError) {
                        cleanupSpinner.error('Cleanup failed');
                        console.warn(colors.yellow('Warning: Could not clean up worktree/branch automatically'));
                        console.log(colors.gray('  You may need to clean up manually:'));
                        console.log(colors.cyan(`    git worktree remove "${worktreePath}" --force`));
                        console.log(colors.cyan(`    git branch -d "${taskBranch}"`));
                    }
                }
            }
            
        } catch (error: any) {
            spinner.error('Merge failed');
            console.log('');
            console.error(colors.red('Error during merge:'), error.message);
            console.log(colors.gray('The repository state has been preserved.'));
        }
        
    } catch (error) {
        console.error(colors.red('Error merging task:'), error);
    }
};