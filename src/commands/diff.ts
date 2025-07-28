import colors from 'ansi-colors';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export const diffCommand = (taskId: string, filePath?: string, options: { onlyFiles?: boolean } = {}) => {
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
        
        // Check if worktree exists
        const worktreePath = join(taskPath, 'workspace');
        if (!existsSync(worktreePath)) {
            console.log(colors.red(`✗ No workspace found for task '${taskId}'`));
            console.log(colors.gray('  Run ') + colors.cyan(`rover task ${taskId}`) + colors.gray(' first'));
            return;
        }
        
        // Check if we're in a git repository
        try {
            execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
        } catch (error) {
            console.log(colors.red('✗ Not in a git repository'));
            return;
        }
        
        console.log(colors.bold(`\n📊 Task ${taskId} Changes\n`));
        console.log(colors.gray('Title: ') + colors.white(taskData.title));
        console.log(colors.gray('Workspace: ') + colors.cyan(worktreePath));
        if (taskData.branchName) {
            console.log(colors.gray('Branch: ') + colors.cyan(taskData.branchName));
        }
        
        // Build git diff command
        const originalCwd = process.cwd();
        
        try {
            // Change to worktree directory to run git diff
            process.chdir(worktreePath);
            
            let gitDiffArgs = ['diff'];
            
            // Add only-files flag if specified
            if (options.onlyFiles) {
                gitDiffArgs.push('--name-only');
            }
            
            // Compare with main branch (or whatever the main branch is)
            let mainBranch = 'main';
            try {
                // Try to detect the default branch
                const remoteHead = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo ""', { stdio: 'pipe' }).toString().trim();
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
                            // Use origin/main as fallback
                            mainBranch = 'origin/main';
                        }
                    }
                }
            } catch (error) {
                // Use main as default fallback
                mainBranch = 'main';
            }
            
            gitDiffArgs.push(mainBranch);
            
            // Add specific file path if provided
            if (filePath) {
                gitDiffArgs.push('--', filePath);
                console.log(colors.gray('File: ') + colors.cyan(filePath));
            }
            
            console.log(colors.gray(`\nComparing with: `) + colors.cyan(mainBranch));
            
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
            console.log(colors.gray('\nTip: Use ') + colors.cyan(`rover diff ${taskId} --only-files`) + colors.gray(' to see only changed filenames'));
            console.log(colors.gray('     Use ') + colors.cyan(`rover diff ${taskId} <file>`) + colors.gray(' to see diff for a specific file'));
        }
        
    } catch (error) {
        console.error(colors.red('Error showing task diff:'), error);
    }
};