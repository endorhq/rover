import colors from 'ansi-colors';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';

export const diffCommand = (taskId: string, filePath?: string, options: { onlyFiles?: boolean, branch?: string } = {}) => {
    // Convert string taskId to number
    const numericTaskId = parseInt(taskId, 10);
    if (isNaN(numericTaskId)) {
        console.log(colors.red(`✗ Invalid task ID '${taskId}' - must be a number`));
        return;
    }

    try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);

        // Check if worktree exists
        if (!task.worktreePath || !existsSync(task.worktreePath)) {
            console.log(colors.red(`✗ No workspace found for task '${numericTaskId}'`));
            console.log(colors.gray('  Run ') + colors.cyan(`rover task ${numericTaskId}`) + colors.gray(' first'));
            return;
        }

        // Check if we're in a git repository
        try {
            execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
        } catch (error) {
            console.log(colors.red('✗ Not in a git repository'));
            return;
        }

        console.log(colors.bold(`\n📊 Task ${numericTaskId} Changes\n`));
        console.log(colors.gray('Title: ') + colors.white(task.title));
        console.log(colors.gray('Workspace: ') + colors.cyan(task.worktreePath));
        if (task.branchName) {
            console.log(colors.gray('Branch: ') + colors.cyan(task.branchName));
        }

        // Build git diff command
        const originalCwd = process.cwd();

        try {
            // Change to worktree directory to run git diff
            process.chdir(task.worktreePath);

            let gitDiffArgs = ['diff'];

            // Add only-files flag if specified
            if (options.onlyFiles) {
                gitDiffArgs.push('--name-only');
            }

            // Compare with main branch (or whatever the main branch is)
            if (options.branch) {
                gitDiffArgs.push(options.branch);

                console.log(colors.gray(`\nComparing with: `) + colors.cyan(options.branch));
            }

            // Add specific file path if provided
            if (filePath) {
                gitDiffArgs.push('--', filePath);
                console.log(colors.gray('File: ') + colors.cyan(filePath));
            }

            if (options.onlyFiles) {
                console.log(colors.bold('\n📄 Changed Files:\n'));
            } else {
                console.log(colors.bold('\n📝 Diff:\n'));
            }

            // Execute git diff command
            try {
                const diffOutput = execSync(`git ${gitDiffArgs.join(' ')}`, {
                    stdio: 'pipe',
                    encoding: 'utf8'
                });

                if (diffOutput.trim() === '') {
                    if (filePath) {
                        console.log(colors.yellow(`No changes found for file: ${filePath}`));
                    } else {
                        console.log(colors.yellow('No changes found in workspace'));
                    }
                } else {
                    if (options.onlyFiles) {
                        // Display file list with colors
                        const files = diffOutput.trim().split('\n');
                        files.forEach(file => {
                            console.log(colors.cyan(`  ${file}`));
                        });
                        console.log(colors.gray(`\nTotal changed files: ${files.length}`));
                    } else {
                        // Display full diff with syntax highlighting
                        const lines = diffOutput.split('\n');
                        lines.forEach(line => {
                            if (line.startsWith('@@')) {
                                console.log(colors.magenta(line));
                            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                                console.log(colors.green(line));
                            } else if (line.startsWith('-') && !line.startsWith('---')) {
                                console.log(colors.red(line));
                            } else if (line.startsWith('diff --git')) {
                                console.log(colors.bold(colors.white(line)));
                            } else if (line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
                                console.log(colors.gray(line));
                            } else {
                                console.log(line);
                            }
                        });
                    }
                }

            } catch (gitError: any) {
                if (gitError.status === 1 && gitError.stderr.toString().trim() === '') {
                    // Exit code 1 with no stderr usually means no differences
                    if (filePath) {
                        console.log(colors.yellow(`No changes found for file: ${filePath}`));
                    } else {
                        console.log(colors.yellow('No changes found in workspace'));
                    }
                } else {
                    console.error(colors.red('Error running git diff:'), gitError.message);
                    if (gitError.stderr) {
                        console.error(colors.red(gitError.stderr.toString()));
                    }
                }
            }

        } catch (error: any) {
            console.error(colors.red('Error accessing workspace:'), error.message);
        } finally {
            // Always restore original working directory
            process.chdir(originalCwd);
        }

        // Show additional context if not showing only files
        if (!options.onlyFiles && !filePath) {
            console.log(colors.gray('\nTip: Use ') + colors.cyan(`rover diff ${numericTaskId} --only-files`) + colors.gray(' to see only changed filenames'));
            console.log(colors.gray('     Use ') + colors.cyan(`rover diff ${numericTaskId} <file>`) + colors.gray(' to see diff for a specific file'));
        }

    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            console.log(colors.red(`✗ ${error.message}`));
        } else {
            console.error(colors.red('Error showing task diff:'), error);
        }
    }
};