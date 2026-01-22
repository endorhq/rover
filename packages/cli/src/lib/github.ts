import { launch, launchSync } from 'rover-core';

export class GitHubError extends Error {
  constructor(reason: string) {
    super(`Error running gh command. Reason: ${reason}`);
    this.name = 'GitHubError';
  }
}

type GitHubIssueResult = {
  title: string;
  body: string;
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
   * @throws GitHubError
   */
  async fetchIssue(
    number: string | number,
    remoteUrl: string
  ): Promise<GitHubIssueResult> {
    const repoInfo = this.getGitHubRepoInfo(remoteUrl);

    if (repoInfo) {
      // First, CLI. If it's not available, it will fail.
      const result = await launch('gh', [
        'issue',
        'view',
        number.toString(),
        '--repo',
        `${repoInfo.owner}/${repoInfo.repo}`,
        '--json',
        'title,body',
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
          return {
            title: issue.title || '',
            body: issue.body || '',
          };
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
          return {
            title: issue.title,
            body: issue.body || '',
          };
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
        ['issue', 'view', number.toString(), '--json', 'title,body'],
        { cwd: this.cwd }
      );

      if (result.failed || result.stdout == null) {
        throw new GitHubError('The GitHub CLI failed to retrieve the issue');
      } else {
        // Return the data
        try {
          const issue = JSON.parse(result.stdout.toString());
          return {
            title: issue.title,
            body: issue.body || '',
          };
        } catch (_err) {
          throw new GitHubError(
            'The GitHub CLI returned an invalid JSON response: ' + result.stdout
          );
        }
      }
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
