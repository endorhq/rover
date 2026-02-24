export interface RepoInfo {
  provider: 'github' | 'gitlab';
  host: string;
  projectPath: string;
}

/**
 * Get repository info (provider, host, project path) from a git remote URL.
 * Supports GitHub and GitLab, including self-hosted instances and SSH aliases.
 */
export const getRepoInfo = (remoteUrl: string): RepoInfo | null => {
  let host: string;
  let pathPart: string;

  // SCP-style: git@host:path/to/repo.git (no :// in the URL)
  const scpMatch = remoteUrl.match(/^[^@]+@([^:]+):(.+?)(?:\.git)?$/);
  if (scpMatch && !remoteUrl.includes('://')) {
    host = scpMatch[1];
    pathPart = scpMatch[2];
  } else {
    // URL-style: https://host/path or ssh://git@host/path
    const urlMatch = remoteUrl.match(
      /^(?:https?|ssh):\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?$/
    );
    if (urlMatch) {
      host = urlMatch[1];
      pathPart = urlMatch[2];
    } else {
      return null;
    }
  }

  // Determine provider from hostname
  const hostLower = host.toLowerCase();
  if (hostLower.includes('github')) {
    return {
      provider: 'github',
      host: hostLower.includes('.') ? host : 'github.com',
      projectPath: pathPart,
    };
  }

  if (hostLower.includes('gitlab')) {
    return {
      provider: 'gitlab',
      host: hostLower.includes('.') ? host : 'gitlab.com',
      projectPath: pathPart,
    };
  }

  return null;
};
