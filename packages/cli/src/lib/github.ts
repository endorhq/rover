import { launch, launchSync } from 'rover-core';

export class GitHubError extends Error {
  constructor(reason: string) {
    super(`Error running gh command. Reason: ${reason}`);
    this.name = 'GitHubError';
  }
}

type GitHubComment = {
  author: string;
  body: string;
  createdAt: string;
};

type GitHubIssueResult = {
  title: string;
  body: string;
  comments?: GitHubComment[];
};

type FetchIssueOptions = {
  includeComments?: boolean;
  since?: string;
};

export type GitHubOptions = {
  /** Working directory for gh CLI commands */
  cwd?: string;
  /** Check if gh CLI is present and throw if not */
  requireGitHubCli?: boolean;
};

/**
 * Generic class to interact with GitHub projects. It uses the git repository data
 * and the gh tool.
 */
export class GitHub {
  private readonly cwd?: string;

  /**
   * Initialize the GitHub class.
   *
   * @param options Configuration options
   */
  constructor(options: GitHubOptions = {}) {
    this.cwd = options.cwd;

    if (options.requireGitHubCli && !GitHub.isGhCLIAvailable()) {
      throw new GitHubError('GitHub CLI (gh) is not installed');
    }
  }

  // Check if the gh CLI is availbe on the system.
  static isGhCLIAvailable(): boolean {
    const result = launchSync('gh', ['--version']);
    return result.failed === false;
  }

  /**
   * Fetch the GitHub issue title and body from the given issue number and
   * remote URL. It will try to use the gh CLI and the API as a fallback.
   *
   * @param number - The issue number
   * @param remoteUrl - The remote URL of the repository
   * @param options - Optional configuration for fetching
   * @param options.includeComments - Whether to include issue comments
   * @throws GitHubError
   */
  async fetchIssue(
    number: string | number,
    remoteUrl: string,
    options: FetchIssueOptions = {}
  ): Promise<GitHubIssueResult> {
    const { includeComments = false, since } = options;
    const repoInfo = this.getGitHubRepoInfo(remoteUrl);
    const jsonFields = includeComments ? 'title,body,comments' : 'title,body';

    if (repoInfo) {
      // First, CLI. If it's not available, it will fail.
      const result = await launch('gh', [
        'issue',
        'view',
        number.toString(),
        '--repo',
        `${repoInfo.owner}/${repoInfo.repo}`,
        '--json',
        jsonFields,
      ]);

      if (result.failed || result.stdout == null) {
        // Fallback to the API
        try {
          const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${number}`;
          const response = await fetch(apiUrl, {
            headers: {
              'User-Agent': 'Rover-CLI',
              Accept: 'application/vnd.github.v3+json',
            },
          });

          if (!response.ok) {
            throw new GitHubError(
              `GitHub API returned status ${response.status}: ${response.statusText}`
            );
          }

          const issue = await response.json();
          const issueResult: GitHubIssueResult = {
            title: issue.title || '',
            body: issue.body || '',
          };

          // Fetch comments if requested
          if (includeComments) {
            issueResult.comments = await this.fetchIssueComments(
              repoInfo.owner,
              repoInfo.repo,
              number,
              since
            );
          }

          return issueResult;
        } catch (err) {
          if (err instanceof GitHubError) {
            throw err;
          }
          throw new GitHubError(
            `Failed to fetch issue from GitHub API: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      } else {
        // Return the data
        try {
          const issue = JSON.parse(result.stdout.toString());
          const issueResult: GitHubIssueResult = {
            title: issue.title,
            body: issue.body || '',
          };

          // Parse comments from gh CLI response
          if (includeComments && issue.comments) {
            let comments = this.parseGhCliComments(issue.comments);
            if (since) {
              const sinceDate = new Date(since);
              comments = comments.filter(
                c => new Date(c.createdAt) > sinceDate
              );
            }
            issueResult.comments = comments;
          }

          return issueResult;
        } catch (_err) {
          throw new GitHubError(
            'The GitHub CLI returned an invalid JSON response: ' + result.stdout
          );
        }
      }
    } else {
      // Couldn't detect the repo (Enterprise?). Let's try just with the CLI
      if (!GitHub.isGhCLIAvailable()) {
        throw new GitHubError(
          'The GitHub CLI is not installed and it is required for this repository'
        );
      }

      const result = await launch(
        'gh',
        ['issue', 'view', number.toString(), '--json', jsonFields],
        { cwd: this.cwd }
      );

      if (result.failed || result.stdout == null) {
        throw new GitHubError('The GitHub CLI failed to retrieve the issue');
      } else {
        // Return the data
        try {
          const issue = JSON.parse(result.stdout.toString());
          const issueResult: GitHubIssueResult = {
            title: issue.title,
            body: issue.body || '',
          };

          // Parse comments from gh CLI response
          if (includeComments && issue.comments) {
            let comments = this.parseGhCliComments(issue.comments);
            if (since) {
              const sinceDate = new Date(since);
              comments = comments.filter(
                c => new Date(c.createdAt) > sinceDate
              );
            }
            issueResult.comments = comments;
          }

          return issueResult;
        } catch (_err) {
          throw new GitHubError(
            'The GitHub CLI returned an invalid JSON response: ' + result.stdout
          );
        }
      }
    }
  }

  /**
   * Parse comments from gh CLI JSON response format
   */
  private parseGhCliComments(
    comments: Array<{
      author?: { login?: string };
      body?: string;
      createdAt?: string;
    }>
  ): GitHubComment[] {
    return comments.map(comment => ({
      author: comment.author?.login || 'unknown',
      body: comment.body || '',
      createdAt: comment.createdAt || '',
    }));
  }

  /**
   * Fetch comments for an issue using the GitHub API
   */
  private async fetchIssueComments(
    owner: string,
    repo: string,
    issueNumber: string | number,
    since?: string
  ): Promise<GitHubComment[]> {
    try {
      let apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
      if (since) {
        apiUrl += `?since=${encodeURIComponent(since)}`;
      }
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Rover-CLI',
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        // Non-fatal: return empty comments array if we can't fetch them
        return [];
      }

      const comments = await response.json();
      return comments.map(
        (comment: {
          user?: { login?: string };
          body?: string;
          created_at?: string;
        }) => ({
          author: comment.user?.login || 'unknown',
          body: comment.body || '',
          createdAt: comment.created_at || '',
        })
      );
    } catch (_err) {
      // Non-fatal: return empty comments array if we can't fetch them
      return [];
    }
  }

  /**
   * Retrieves the owner and repo from the remote URL. Null in case it couldn't
   * detect it.
   */
  getGitHubRepoInfo(remoteUrl: string): { owner: string; repo: string } | null {
    // Handle various GitHub URL formats
    const patterns = [
      /github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/,
      /^git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/,
      /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/,
    ];

    for (const pattern of patterns) {
      const match = remoteUrl.match(pattern);
      if (match) {
        return { owner: match[1], repo: match[2] };
      }
    }

    return null;
  }
}

/**
 * Format a date string to a more readable format (YYYY-MM-DD)
 */
export const formatCommentDate = (dateString: string): string => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  } catch {
    return dateString;
  }
};

/**
 * Format GitHub comments as markdown to append to the issue body
 */
export const formatCommentsAsMarkdown = (
  comments: Array<{ author: string; body: string; createdAt: string }>
): string => {
  if (!comments || comments.length === 0) return '';

  const formattedComments = comments
    .map(comment => {
      const date = formatCommentDate(comment.createdAt);
      const dateStr = date ? ` (${date})` : '';
      return `**@${comment.author}**${dateStr}:\n${comment.body}`;
    })
    .join('\n\n');

  return `\n\n---\n## Comments\n\n${formattedComments}`;
};
