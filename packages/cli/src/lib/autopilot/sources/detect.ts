import { Git, launch } from 'rover-core';
import type { PlatformSource, RepoInfo } from './types.js';

/**
 * Detect GitHub vs GitLab from a git remote URL using hostname heuristics.
 * Returns `null` for unrecognised hosts (e.g. self-hosted instances).
 */
export function detectSource(remoteUrl: string): PlatformSource | null {
  const hostname = extractHostname(remoteUrl);
  if (!hostname) return null;

  const lower = hostname.toLowerCase();
  if (lower.includes('github')) return 'github';
  if (lower.includes('gitlab')) return 'gitlab';

  return null;
}

/**
 * Async fallback for self-hosted instances where the hostname gives no hint.
 * Probes the `glab` and `gh` CLIs to determine the platform.
 */
export async function detectSourceWithProbe(
  remoteUrl: string,
  cwd: string
): Promise<PlatformSource | null> {
  // Probe GitLab first (glab resolves :id from cwd context)
  try {
    const result = await launch('glab', ['api', 'projects/:id'], { cwd });
    if (!result.failed) return 'gitlab';
  } catch {
    // glab not installed or not authenticated
  }

  // Probe GitHub — extract path directly since detectSource already failed
  const path = extractPath(remoteUrl);
  if (path) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 2) {
      try {
        const fullPath = segments.join('/');
        const result = await launch('gh', ['api', `repos/${fullPath}`]);
        if (!result.failed) return 'github';
      } catch {
        // gh not installed or not authenticated
      }
    }
  }

  return null;
}

/**
 * Parse a git remote URL into structured repo information.
 * Supports SSH (`git@host:path`), HTTPS (`https://host/path`), and
 * aliased SSH hosts (`alias:path`).
 *
 * When `source` is provided it is used directly, skipping hostname detection.
 * This is useful after a CLI probe has already determined the platform.
 */
export function parseRepoInfo(
  remoteUrl: string,
  source?: PlatformSource
): RepoInfo | null {
  const resolved = source ?? detectSource(remoteUrl);
  if (!resolved) return null;

  const path = extractPath(remoteUrl);
  if (!path) return null;

  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  return {
    source: resolved,
    fullPath: segments.join('/'),
    owner: segments[0],
    repo: segments[segments.length - 1],
  };
}

/**
 * Extract repo info (source + owner/repo) from the git remote of a project.
 * Tries fast hostname-based detection first, then falls back to CLI probing
 * for self-hosted instances.
 */
export async function getRepoInfo(
  projectPath: string
): Promise<RepoInfo | null> {
  const git = new Git({ cwd: projectPath });
  const remoteUrl = git.remoteUrl();
  if (!remoteUrl) return null;

  // Fast path: hostname contains "github" or "gitlab"
  const fast = parseRepoInfo(remoteUrl);
  if (fast) return fast;

  // Slow path: probe CLIs for self-hosted instances
  const probed = await detectSourceWithProbe(remoteUrl, projectPath);
  if (!probed) return null;

  return parseRepoInfo(remoteUrl, probed);
}

/** Extract hostname from SSH or HTTPS remote URLs. */
function extractHostname(url: string): string | null {
  // SSH: git@hostname:path or ssh://git@hostname/path
  const sshMatch = url.match(/^(?:ssh:\/\/)?[^@]+@([^:/]+)/);
  if (sshMatch) return sshMatch[1];

  // HTTPS: https://hostname/path
  const httpsMatch = url.match(/^https?:\/\/([^/]+)/);
  if (httpsMatch) return httpsMatch[1];

  // Aliased SSH: alias:path — hostname is the alias, which may contain
  // platform hints (e.g. "github-personal:owner/repo")
  const aliasMatch = url.match(/^([^:/]+):/);
  if (aliasMatch) return aliasMatch[1];

  return null;
}

/** Extract the path component (owner/repo) from a remote URL, stripping `.git`. */
function extractPath(url: string): string | null {
  let path: string | null = null;

  // SSH: git@host:path.git
  const sshMatch = url.match(/^(?:ssh:\/\/)?[^@]+@[^:/]+[:/](.+)$/);
  if (sshMatch) path = sshMatch[1];

  // HTTPS: https://host/path.git
  if (!path) {
    const httpsMatch = url.match(/^https?:\/\/[^/]+\/(.+)$/);
    if (httpsMatch) path = httpsMatch[1];
  }

  // Aliased SSH: alias:path
  if (!path) {
    const aliasMatch = url.match(/^[^:/]+:(.+)$/);
    if (aliasMatch) path = aliasMatch[1];
  }

  if (!path) return null;

  // Strip .git suffix
  return path.replace(/\.git$/, '');
}
