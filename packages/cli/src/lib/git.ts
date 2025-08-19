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
}

export default Git;