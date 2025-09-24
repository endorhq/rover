import { launch, launchSync } from './os.js';

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
  async version(): Promise<string> {
    try {
      const result = await launch('git', ['--version']);
      return result.stdout?.toString() || 'unknown';
    } catch (error) {
      throw new GitError(`Failed to get git version: ${error}`);
    }
  }

  async isGitRepo(): Promise<boolean> {
    try {
      const result = await launch(
        'git',
        ['rev-parse', '--is-inside-work-tree'],
        {
          reject: false,
        }
      );
      return result.exitCode === 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get the root directory of the Git repository
   */
  async getRepositoryRoot(): Promise<string> {
    try {
      const result = await launch('git', ['rev-parse', '--show-toplevel'], {
        reject: false,
      });
      if (result.exitCode === 0) {
        const root = result.stdout?.toString().trim();
        if (root) {
          return root;
        }
      }
      throw new GitError('Not in a git repository');
    } catch (error) {
      if (error instanceof GitError) {
        throw error;
      }
      throw new GitError(`Failed to get repository root: ${error}`);
    }
  }

  async hasCommits(): Promise<boolean> {
    try {
      const result = await launch('git', ['rev-list', '--count', 'HEAD'], {
        reject: false,
      });
      return result.exitCode === 0;
    } catch (error) {
      return false;
    }
  }

  async diff(options: GitDiffOptions = {}): Promise<ReturnType<typeof launch>> {
    try {
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

      const diffResult = await launch('git', args, {
        cwd: options.worktreePath,
      });

      // If includeUntracked is true and we're not filtering by a specific file,
      // append untracked files to the diff output
      if (options.includeUntracked && !options.filePath) {
        // Use git ls-files to get the actual untracked files (not just directories)
        let untrackedFiles: string[] = [];
        const lsFilesResult = await launch(
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
              const untrackedDiff = await launch(
                'git',
                ['diff', '--no-index', '/dev/null', file],
                {
                  cwd: options.worktreePath,
                  reject: false,
                }
              );

              if (
                untrackedDiff.exitCode === 0 ||
                untrackedDiff.exitCode === 1
              ) {
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
    } catch (error) {
      throw new GitError(`Failed to get diff: ${error}`);
    }
  }

  /**
   * Add the given file
   */
  async add(file: string, options: GitWorktreeOptions = {}): Promise<void> {
    try {
      await launch('git', ['add', file], {
        cwd: options.worktreePath,
      });
    } catch (error) {
      throw new GitError(`Failed to add file '${file}': ${error}`);
    }
  }

  /**
   * Add all files and commit it
   */
  async addAndCommit(
    message: string,
    options: GitWorktreeOptions = {}
  ): Promise<void> {
    try {
      await launch('git', ['add', '-A'], {
        cwd: options.worktreePath,
      });

      await launch('git', ['commit', '-m', message], {
        cwd: options.worktreePath,
      });
    } catch (error) {
      throw new GitError(`Failed to add and commit: ${error}`);
    }
  }

  /**
   * Return the remote URL for the given origin
   */
  async remoteUrl(options: GitRemoteUrlOptions = {}): Promise<string> {
    const remoteName = options.remoteName || 'origin';

    try {
      const result = await launch('git', ['remote', 'get-url', remoteName], {
        cwd: options.worktreePath,
        reject: false,
      });

      if (result.exitCode === 0) {
        return result?.stdout?.toString().trim() || '';
      }

      throw new GitError(`Remote '${remoteName}' not found`);
    } catch (error) {
      if (error instanceof GitError) {
        throw error;
      }
      throw new GitError(
        `Failed to get remote URL for '${remoteName}': ${error}`
      );
    }
  }

  /**
   * Merge a branch into the current one
   */
  async mergeBranch(
    branch: string,
    message: string,
    options: GitWorktreeOptions = {}
  ): Promise<void> {
    try {
      await launch('git', ['merge', '--no-ff', branch, '-m', message], {
        cwd: options.worktreePath,
      });
    } catch (error) {
      throw new GitError(`Failed to merge branch '${branch}': ${error}`);
    }
  }

  /**
   * Abort current merge
   */
  async abortMerge(options: GitWorktreeOptions = {}): Promise<void> {
    try {
      await launch('git', ['merge', '--abort'], {
        cwd: options.worktreePath,
        reject: false,
      });
    } catch (error) {
      // Ignore abort errors - merge may not be in progress
    }
  }

  /**
   * Continue current merge
   */
  async continueMerge(options: GitWorktreeOptions = {}): Promise<void> {
    try {
      await launch('git', ['merge', '--continue'], {
        cwd: options.worktreePath,
      });
    } catch (error) {
      throw new GitError(`Failed to continue merge: ${error}`);
    }
  }

  /**
   * Prune worktrees that are no longer available in
   * the filesystem
   */
  async pruneWorktree(): Promise<void> {
    try {
      await launch('git', ['worktree', 'prune']);
    } catch (error) {
      throw new GitError(`Failed to prune worktrees: ${error}`);
    }
  }

  /**
   * Check if the current workspace has merge conflicts.
   */
  async getMergeConflicts(options: GitWorktreeOptions = {}): Promise<string[]> {
    try {
      // Check if we're in a merge state
      const result = await launch('git', ['status', '--porcelain'], {
        cwd: options.worktreePath,
        reject: false,
      });

      if (result.exitCode !== 0) {
        return [];
      }

      const status = result.stdout?.toString().trim();

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
      return [];
    }
  }

  /**
   * Check if the given worktree path has uncommitted changes
   */
  async uncommittedChanges(
    options: GitUncommittedChangesOptions = {}
  ): Promise<string[]> {
    try {
      const args = ['status', '--porcelain'];

      if (options.skipUntracked) {
        args.push('-u', 'no');
      }

      const result = await launch('git', args, {
        cwd: options.worktreePath,
        reject: false,
      });

      if (result.exitCode !== 0) {
        return [];
      }

      const status = result.stdout?.toString().trim() || '';

      if (status.length == 0) {
        return [];
      }

      return status.split('\n');
    } catch {
      return [];
    }
  }

  /**
   * Check if the given worktree path has uncommitted changes
   */
  async hasUncommittedChanges(
    options: GitUncommittedChangesOptions = {}
  ): Promise<boolean> {
    try {
      const uncommittedFiles = await this.uncommittedChanges(options);
      return uncommittedFiles.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if the given branch has unmerged commits referencing the target branch
   * or just the current one.
   */
  async hasUnmergedCommits(
    srcBranch: string,
    options: GitUnmergedCommits = {}
  ): Promise<boolean> {
    try {
      const targetBranch =
        options.targetBranch || (await this.getCurrentBranch());

      const result = await launch(
        'git',
        ['log', `${targetBranch}..${srcBranch}`, '--oneline'],
        {
          reject: false,
        }
      );

      if (result.exitCode !== 0) {
        return false;
      }

      const unmergedCommits = result.stdout?.toString().trim() || '';
      return unmergedCommits.length > 0;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Check the current branch
   */
  async getCurrentBranch(options: GitWorktreeOptions = {}): Promise<string> {
    try {
      const result = await launch('git', ['branch', '--show-current'], {
        cwd: options.worktreePath,
        reject: false,
      });

      if (result.exitCode === 0) {
        return result.stdout?.toString().trim() || 'unknown';
      }

      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Check if a given branch exists
   */
  async branchExists(branch: string): Promise<boolean> {
    try {
      const result = await launch(
        'git',
        ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
        { reject: false }
      );
      return result.exitCode === 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create worktree
   */
  async createWorktree(
    path: string,
    branchName: string,
    baseBranch?: string
  ): Promise<void> {
    try {
      if (await this.branchExists(branchName)) {
        const result = await launch(
          'git',
          ['worktree', 'add', path, branchName],
          {
            reject: false,
          }
        );
        if (result.exitCode !== 0) {
          throw new GitError(
            `Failed to create worktree: ${result.stderr?.toString() || 'Unknown error'}`
          );
        }
      } else {
        // Create new branch from base branch if specified, otherwise from current branch
        const args = baseBranch
          ? ['worktree', 'add', path, '-b', branchName, baseBranch]
          : ['worktree', 'add', path, '-b', branchName];

        const result = await launch('git', args, { reject: false });
        if (result.exitCode !== 0) {
          throw new GitError(
            `Failed to create worktree: ${result.stderr?.toString() || 'Unknown error'}`
          );
        }
      }
    } catch (error) {
      if (error instanceof GitError) {
        throw error;
      }
      throw new GitError(
        `Failed to create worktree '${path}' for branch '${branchName}': ${error}`
      );
    }
  }

  /**
   * Identify the main / master branch for the given repository.
   */
  async getMainBranch(): Promise<string> {
    // Default to 'main'
    let branch = 'main';

    try {
      const result = await launch(
        'git',
        ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        { reject: false }
      );

      if (result.exitCode === 0) {
        const remoteHead = result.stdout?.toString().trim();
        if (remoteHead) {
          branch = remoteHead.replace('refs/remotes/origin/', '');
        }
      } else {
        // Fallback: check if main or master exists
        const mainResult = await launch(
          'git',
          ['show-ref', '--verify', '--quiet', 'refs/heads/main'],
          { reject: false }
        );

        if (mainResult.exitCode === 0) {
          branch = 'main';
        } else {
          const masterResult = await launch(
            'git',
            ['show-ref', '--verify', '--quiet', 'refs/heads/master'],
            { reject: false }
          );

          if (masterResult.exitCode === 0) {
            branch = 'master';
          } else {
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
  async getRecentCommits(
    options: GitRecentCommitOptions = {}
  ): Promise<string[]> {
    try {
      const commitBranch = options.branch || (await this.getMainBranch());
      const result = await launch(
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
          reject: false,
        }
      );

      if (result.exitCode !== 0) {
        return [];
      }

      const commits = result.stdout?.toString().trim();

      if (!commits) {
        return [];
      }

      return commits.split('\n').filter(line => line.trim() !== '');
    } catch (error) {
      return [];
    }
  }

  /**
   * Push branch to remote
   */
  async push(branch: string, options: GitPushOptions = {}): Promise<void> {
    try {
      const args = ['push'];

      if (options.setUpstream) {
        args.push('--set-upstream');
      }

      args.push('origin', branch);

      const result = await launch('git', args, {
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
    } catch (error) {
      if (error instanceof GitError) {
        throw error;
      }
      throw new GitError(`Failed to push branch '${branch}': ${error}`);
    }
  }
}
