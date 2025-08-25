import { SpawnSyncReturns, spawnSync } from 'node:child_process';

export class GitError extends Error {
    constructor(reason: string) {
        super(`Error running git command. Reason: ${reason}`);
        this.name = 'GitError';
    }
}

export type GitDiffOptions = {
    worktreePath?: string;
    filePath?: string;
    onlyFiles?: boolean;
    branch?: string;
}

export type GitWorktreeOptions = {
    worktreePath?: string
};

export type GitRecentCommitOptions = {
    count?: number,
    branch?: string,
    worktreePath?: string
}

export type GitUncommitedChangesOptions = {
    skipUntracked?: boolean,
    worktreePath?: string;
}

export type GitUnmergedCommits = {
    targetBranch?: string,
    worktreePath?: string
}

export type GitPushOptions = {
    setUpstream?: boolean;
    worktreePath?: string;
}

export type GitRemoteUrlOptions = {
    remoteName?: string;
    worktreePath?: string;
}

/**
 * A class to manage and run docker commands
 */
export class Git {
    constructor() {
        // Check docker is available
        if (spawnSync('git', ['--version'], { stdio: 'pipe' }).error) {
            throw new GitError('Git is not installed.');
        }
    }

    isGitRepo(): boolean {
        const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
        return result.status === 0;
    }

    hasCommits(): boolean {
        const result = spawnSync('git', ['rev-list', '--count', 'HEAD'], { stdio: 'pipe' });
        return result.status === 0;
    }

    diff(options: GitDiffOptions = {}): SpawnSyncReturns<Buffer | string> {
        const args = ['diff'];

        if (options.onlyFiles) {
            args.push('--name-only');
        }

        if (options.branch) {
            args.push(options.branch);
        }

        if (options.filePath) {
            args.push('--', options.filePath);
        }

        return spawnSync('git', args, {
            stdio: 'pipe',
            encoding: 'utf8',
            cwd: options.worktreePath
        });
    }

    /**
     * Add the given file
     */
    add(file: string, options: GitWorktreeOptions = {}): boolean {
        try {
            spawnSync('git', ['add', file], {
                stdio: 'pipe',
                encoding: 'utf8',
                cwd: options.worktreePath
            });
            return true;
        } catch (_err) {
            return false;
        }
    }

    /**
     * Add all files and commit it
     */
    addAndCommit(message: string, options: GitWorktreeOptions = {}): boolean {
        try {
            spawnSync('git', ['add', '-A'], {
                stdio: 'pipe',
                encoding: 'utf8',
                cwd: options.worktreePath
            });

            spawnSync('git', ['commit', '-m', message], {
                stdio: 'pipe',
                encoding: 'utf8',
            });

            return true;
        } catch (_err) {
            return false;
        }
    }

    /**
     * Return the remote URL for the given origin
     */
    remoteUrl(options: GitRemoteUrlOptions = {}): string {
        const remoteName = options.remoteName || 'origin';

        try {
            const result = spawnSync('git', ['remote', 'get-url', remoteName], {
                stdio: 'pipe',
                cwd: options.worktreePath
            });

            return result.status == 0 ? result.stdout.toString().trim() : '';
        } catch (_err) {
            return '';
        }
    }

    /**
     * Merge a branch into the current one
     */
    mergeBranch(branch: string, message: string, options: GitWorktreeOptions = {}): boolean {
        try {
            spawnSync('git', ['merge', '--no-ff', branch, '-m', message], {
                stdio: 'pipe',
                cwd: options.worktreePath
            });

            return true;
        } catch (_err) {
            // There was an error with the merge
            return false;
        }
    }

    /**
     * Abort current merge
     */
    abortMerge(options: GitWorktreeOptions = {}) {
        try {
            spawnSync('git', ['merge', '--abort'], {
                stdio: 'pipe',
                cwd: options.worktreePath
            });
        } catch (_err) {
            // Ignore abort errors
        }
    }

    /**
     * Continue current merge
     */
    continueMerge(options: GitWorktreeOptions = {}) {
        try {
            spawnSync('git', ['merge', '--continue'], {
                stdio: 'pipe',
                cwd: options.worktreePath
            });
        } catch (_err) {
            // Ignore abort errors
        }
    }

    /**
     * Prune worktrees that are no longer available in 
     * the filesystem
     */
    pruneWorktree(): boolean {
        try {
            spawnSync('git', ['worktree', 'prune'], {
                stdio: 'pipe',
            });
            return true;
        } catch (_err) {
            // Ignore abort errors
            return false;
        }
    }

    /**
     * Check if the current workspace has merge conflicts.
     */
    getMergeConflicts(options: GitWorktreeOptions = {}): string[] {
        try {
            // Check if we're in a merge state
            const status = spawnSync('git', ['status', '--porcelain'], {
                stdio: 'pipe',
                encoding: 'utf8',
                cwd: options.worktreePath
            }).stdout.toString().trim();

            // Look for conflict markers (UU, AA, etc.)
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
            // For now, just return false
            return [];
        }
    }

    /**
     * Check if the given worktree path has uncommited changes
     */
    uncommitedChanges(options: GitUncommitedChangesOptions = {}): string[] {
        try {
            const args = ['status', '--porcelain'];

            if (options.skipUntracked) {
                args.push('-u', 'no');
            }

            const status = spawnSync('git', args, {
                stdio: 'pipe',
                encoding: 'utf8',
                cwd: options.worktreePath
            }).stdout.toString().trim();

            return status.split('\n');
        } catch {
            // For now, no changes. We will add debug logs
            return [];
        }
    }

    /**
     * Check if the given worktree path has uncommited changes
     */
    hasUncommitedChanges(options: GitUncommitedChangesOptions = {}): boolean {
        try {
            const uncommitedFiles = this.uncommitedChanges(options);
            return uncommitedFiles.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Check if the given branch has unmerged commits referencing the target branch
     * or just the current one.
     */
    hasUnmergedCommits(srcBranch: string, options: GitUnmergedCommits = {}): boolean {
        const targetBranch = options.targetBranch || this.getCurrentBranch();

        try {
            const unmergedCommits = spawnSync('git', ['log', `${targetBranch}..${srcBranch}`, '--oneline'], {
                stdio: 'pipe',
                encoding: 'utf8'
            }).stdout.toString().trim();

            return unmergedCommits.length > 0;
        } catch (_err) {
            return false;
        }
    }

    /**
     * Check the current branch
     */
    getCurrentBranch(options: GitWorktreeOptions = {}): string {
        try {
            return spawnSync('git', ['branch', '--show-current'], {
                stdio: 'pipe',
                encoding: 'utf8',
                cwd: options.worktreePath
            }).stdout.toString().trim();
        } catch (error) {
            return 'unknown';
        }
    }

    /**
     * Identify the main / master branch for the given repository.
     */
    getMainBranch(): string {
        // Default to 'main'
        let branch = 'main';

        try {
            const remoteHead = spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            }).stdout.toString().trim();

            if (remoteHead) {
                branch = remoteHead.replace('refs/remotes/origin/', '');
            } else {
                // Fallback: check if main or master exists
                try {
                    spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/main'], { stdio: 'pipe' });
                    branch = 'main';
                } catch (error) {
                    try {
                        spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/master'], { stdio: 'pipe' });
                        branch = 'master';
                    } catch (error) {
                        branch = 'main'; // Default fallback
                    }
                }
            }
        } catch (error) {
            branch = 'main';
        }

        return branch;
    }

    /**
     * Retrieve the commit messages from the given branch
     */
    getRecentCommits(options: GitRecentCommitOptions = {}): string[] {
        const commitBranch = options.branch || this.getMainBranch();
        const commits = spawnSync('git', ['log', commitBranch, '--pretty=format:"%s"', '-n', `${options.count || 15}`], {
            stdio: 'pipe',
            encoding: 'utf8',
            cwd: options.worktreePath
        }).stdout.toString().trim();

        return commits.split('\n').filter(line => line.trim() !== '');
    }

    /**
     * Push branch to remote
     */
    push(branch: string, options: GitPushOptions = {}): void {
        const args = ['push'];

        if (options.setUpstream) {
            args.push('--set-upstream');
        }

        args.push('origin', branch);

        const result = spawnSync('git', args, {
            stdio: 'pipe',
            encoding: 'utf8',
            cwd: options.worktreePath
        });

        if (result.status !== 0) {
            const stderr = result.stderr?.toString() || '';
            const stdout = result.stdout?.toString() || '';
            const errorMessage = stderr || stdout || 'Unknown error';

            // Check if it's because the remote branch doesn't exist
            if (errorMessage.includes('has no upstream branch')) {
                throw new GitError(`Branch '${branch}' has no upstream branch`);
            }

            throw new GitError(errorMessage);
        }
    }
}

export default Git;