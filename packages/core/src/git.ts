import { createReadStream } from 'node:fs';
import { launchSync } from './os.js';
import { join } from 'node:path';

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
  includeUntracked?: boolean;
};

export type GitDiffStatsOptions = {
  worktreePath?: string;
  filePath?: string;
  branch?: string;
  includeUntracked?: boolean;
};

export type GitDiffStatsResult = {
  files: Array<{ path: string; insertions: number; deletions: number }>;
  totalInsertions: number;
  totalDeletions: number;
};

export type GitWorktreeOptions = {
  worktreePath?: string;
};

export type GitRecentCommitOptions = {
  count?: number;
  branch?: string;
  worktreePath?: string;
};

export type GitUncommittedChangesOptions = {
  skipUntracked?: boolean;
  worktreePath?: string;
};

export type GitUnmergedCommits = {
  targetBranch?: string;
  worktreePath?: string;
};

export type GitPushOptions = {
  setUpstream?: boolean;
  worktreePath?: string;
};

export type GitRemoteUrlOptions = {
  remoteName?: string;
  worktreePath?: string;
};

/**
 * A class to manage and run docker commands
 */
export class Git {
  version(): string {
    return launchSync('git', ['--version']).stdout?.toString() || 'unknown';
  }

  isGitRepo(): boolean {
    const result = launchSync('git', ['rev-parse', '--is-inside-work-tree'], {
      reject: false,
    });
    return result.exitCode === 0;
  }

  /**
   * Get the root directory of the Git repository
   */
  getRepositoryRoot(): string | null {
    const result = launchSync('git', ['rev-parse', '--show-toplevel'], {
      reject: false,
    });
    if (result.exitCode === 0) {
      return result.stdout?.toString().trim() || null;
    }
    return null;
  }

  hasCommits(): boolean {
    const result = launchSync('git', ['rev-list', '--count', 'HEAD'], {
      reject: false,
    });
    return result.exitCode === 0;
  }

  diff(options: GitDiffOptions = {}): ReturnType<typeof launchSync> {
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

    const diffResult = launchSync('git', args, {
      cwd: options.worktreePath,
    });

    // If includeUntracked is true and we're not filtering by a specific file,
    // append untracked files to the diff output
    if (options.includeUntracked && !options.filePath) {
      // Use git ls-files to get the actual untracked files (not just directories)
      let untrackedFiles: string[] = [];
      const lsFilesResult = launchSync(
        'git',
        ['ls-files', '--others', '--exclude-standard'],
        {
          cwd: options.worktreePath,
          reject: false,
        }
      );

      if (lsFilesResult.exitCode === 0) {
        untrackedFiles =
          lsFilesResult?.stdout
            ?.toString()
            .split('\n')
            .map(line => line.trim())
            .filter(file => file.length > 0) || [];
      }

      if (untrackedFiles.length > 0) {
        let combinedOutput = diffResult?.stdout?.toString() || '';

        if (options.onlyFiles) {
          // Just append the untracked file names
          if (combinedOutput && !combinedOutput.endsWith('\n')) {
            combinedOutput += '\n';
          }
          combinedOutput += untrackedFiles.join('\n');
        } else {
          // Show full diff for each untracked file
          for (const file of untrackedFiles) {
            const untrackedDiff = launchSync(
              'git',
              ['diff', '--no-index', '/dev/null', file],
              {
                cwd: options.worktreePath,
                reject: false,
              }
            );

            if (untrackedDiff.exitCode === 0 || untrackedDiff.exitCode === 1) {
              // git diff --no-index returns 1 when files differ, which is expected
              if (combinedOutput && !combinedOutput.endsWith('\n')) {
                combinedOutput += '\n';
              }
              if (untrackedDiff?.stdout) {
                combinedOutput += untrackedDiff.stdout.toString();
              }
            }
          }
        }

        // Return a modified result with the combined output
        return {
          ...diffResult,
          stdout: combinedOutput,
        };
      }
    }

    return diffResult;
  }

  async diffStats(options: GitDiffOptions = {}): Promise<GitDiffStatsResult> {
    const args = ['diff', '--numstat'];

    if (options.branch) {
      args.push(options.branch);
    }

    if (options.filePath) {
      args.push('--', options.filePath);
    }

    const files = [];

    const diffResult = launchSync('git', args, {
      cwd: options.worktreePath,
    });

    const output = diffResult.stdout?.toString() || '';
    const lines = output.split('\n').filter(line => line.trim() !== '');

    let totalInsertions = 0;
    let totalDeletions = 0;

    for (const line of lines) {
      const [insertionsStr, deletionsStr, filePath] = line.split('\t');

      const insertions =
        insertionsStr === '-' ? 0 : parseInt(insertionsStr, 10);
      const deletions = deletionsStr === '-' ? 0 : parseInt(deletionsStr, 10);

      totalInsertions += insertions;
      totalDeletions += deletions;

      files.push({ path: filePath, insertions, deletions });
    }

    if (options.includeUntracked && !options.filePath) {
      // Get untracked files
      const lsFilesResult = launchSync(
        'git',
        ['ls-files', '--others', '--exclude-standard'],
        {
          cwd: options.worktreePath,
          reject: false,
        }
      );

      if (lsFilesResult.exitCode === 0) {
        const untrackedFiles =
          lsFilesResult?.stdout
            ?.toString()
            .split('\n')
            .map(line => line.trim())
            .filter(file => file.length > 0) || [];

        for (const file of untrackedFiles) {
          const fileLines = await this.countFileLines(
            join(options.worktreePath || '', file)
          );
          files.push({ path: file, insertions: fileLines, deletions: 0 });
        }
      }
    }

    return {
      totalInsertions,
      totalDeletions,
      files,
    };
  }

  /**
   * Add the given file
   */
  add(file: string, options: GitWorktreeOptions = {}): boolean {
    try {
      launchSync('git', ['add', file], {
        cwd: options.worktreePath,
      });
      return true;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Add all files and commit it
   */
  addAndCommit(message: string, options: GitWorktreeOptions = {}): void {
    launchSync('git', ['add', '-A'], {
      cwd: options.worktreePath,
    });

    launchSync('git', ['commit', '-m', message], {
      cwd: options.worktreePath,
    });
  }

  /**
   * Return the remote URL for the given origin
   */
  remoteUrl(options: GitRemoteUrlOptions = {}): string {
    const remoteName = options.remoteName || 'origin';

    try {
      const result = launchSync('git', ['remote', 'get-url', remoteName], {
        cwd: options.worktreePath,
      });

      return result?.stdout?.toString().trim() || '';
    } catch (_err) {
      return '';
    }
  }

  /**
   * Merge a branch into the current one
   */
  mergeBranch(
    branch: string,
    message: string,
    options: GitWorktreeOptions = {}
  ): boolean {
    try {
      launchSync('git', ['merge', '--no-ff', branch, '-m', message], {
        cwd: options.worktreePath,
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
      launchSync('git', ['merge', '--abort'], {
        cwd: options.worktreePath,
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
      launchSync('git', ['merge', '--continue'], {
        cwd: options.worktreePath,
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
      launchSync('git', ['worktree', 'prune']);
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
      const status = launchSync('git', ['status', '--porcelain'], {
        cwd: options.worktreePath,
      })
        .stdout?.toString()
        .trim();

      if (!status) {
        return [];
      }

      // Look for conflict markers (UU, AA, etc.)
      const conflictFiles = status
        .split('\n')
        .filter(
          line =>
            line.startsWith('UU ') ||
            line.startsWith('AA ') ||
            line.startsWith('DD ') ||
            line.startsWith('AU ') ||
            line.startsWith('UA ') ||
            line.startsWith('DU ') ||
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
   * Check if the given worktree path has uncommitted changes
   */
  uncommittedChanges(options: GitUncommittedChangesOptions = {}): string[] {
    try {
      const args = ['status', '--porcelain'];

      if (options.skipUntracked) {
        args.push('-u', 'no');
      }

      const status =
        launchSync('git', args, {
          cwd: options.worktreePath,
        })
          .stdout?.toString()
          .trim() || '';

      if (status.length == 0) {
        return [];
      }

      return status.split('\n');
    } catch {
      // For now, no changes. We will add debug logs
      return [];
    }
  }

  /**
   * Check if the given worktree path has uncommitted changes
   */
  hasUncommittedChanges(options: GitUncommittedChangesOptions = {}): boolean {
    try {
      const uncommittedFiles = this.uncommittedChanges(options);
      return uncommittedFiles.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if the given branch has unmerged commits referencing the target branch
   * or just the current one.
   */
  hasUnmergedCommits(
    srcBranch: string,
    options: GitUnmergedCommits = {}
  ): boolean {
    const targetBranch = options.targetBranch || this.getCurrentBranch();

    try {
      const unmergedCommits =
        launchSync('git', ['log', `${targetBranch}..${srcBranch}`, '--oneline'])
          .stdout?.toString()
          .trim() || '';

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
      return (
        launchSync('git', ['branch', '--show-current'], {
          cwd: options.worktreePath,
        })
          .stdout?.toString()
          .trim() || 'unknown'
      );
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Check if a given branch exists
   */
  branchExists(branch: string): boolean {
    try {
      return (
        launchSync(
          'git',
          ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
          { reject: false }
        ).exitCode === 0
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Create worktree
   */
  createWorktree(
    path: string,
    branchName: string,
    baseBranch?: string
  ): boolean {
    if (this.branchExists(branchName)) {
      return (
        launchSync('git', ['worktree', 'add', path, branchName], {
          reject: false,
        }).exitCode == 0
      );
    }
    // Create new branch from base branch if specified, otherwise from current branch
    const args = baseBranch
      ? ['worktree', 'add', path, '-b', branchName, baseBranch]
      : ['worktree', 'add', path, '-b', branchName];
    return launchSync('git', args, { reject: false }).exitCode == 0;
  }

  /**
   * Identify the main / master branch for the given repository.
   */
  getMainBranch(): string {
    // Default to 'main'
    let branch = 'main';

    try {
      const remoteHead = launchSync('git', [
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
      ])
        .stdout?.toString()
        .trim();

      if (remoteHead) {
        branch = remoteHead.replace('refs/remotes/origin/', '');
      } else {
        // Fallback: check if main or master exists
        try {
          launchSync('git', [
            'show-ref',
            '--verify',
            '--quiet',
            'refs/heads/main',
          ]);
          branch = 'main';
        } catch (error) {
          try {
            launchSync('git', [
              'show-ref',
              '--verify',
              '--quiet',
              'refs/heads/master',
            ]);
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
    const commits = launchSync(
      'git',
      [
        'log',
        commitBranch,
        '--pretty=format:"%s"',
        '-n',
        `${options.count || 15}`,
      ],
      {
        cwd: options.worktreePath,
      }
    )
      .stdout?.toString()
      .trim();

    if (!commits) {
      return [];
    }

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

    const result = launchSync('git', args, {
      cwd: options.worktreePath,
      reject: false,
    });

    if (result.exitCode !== 0) {
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

  /**
   * Count file lines efficiently.
   * @see https://stackoverflow.com/a/41439945
   */
  private async countFileLines(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let lineCount = 0;
      createReadStream(filePath)
        .on('data', buffer => {
          let idx = -1;
          lineCount--; // Because the loop will run once for idx=-1
          do {
            idx = (buffer as Buffer<ArrayBufferLike>).indexOf(10, idx + 1);
            lineCount++;
          } while (idx !== -1);
        })
        .on('end', () => {
          resolve(lineCount);
        })
        .on('error', reject);
    });
  }
}
