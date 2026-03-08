import type { Git } from 'rover-core';

export function resolveTaskCollapseRef(
  git: Pick<Git, 'getCommitHash'>,
  worktreePath: string,
  baseCommit?: string,
  preferredRef?: string
): string | undefined {
  if (preferredRef) {
    const preferredHash = git.getCommitHash(preferredRef, { worktreePath });
    if (preferredHash) {
      return preferredRef;
    }
  }

  return baseCommit;
}

/**
 * Collapse **all** commits made since `baseCommit` into a single set of staged
 * changes via `git reset --soft`. This includes both checkpoint commits and any
 * regular commits in the range — rover task worktrees are isolated so every
 * commit since the base belongs to the current task.
 *
 * After this call the working tree is unchanged, HEAD points to `baseCommit`,
 * and the cumulative diff is staged. The next `git commit` produces one clean
 * commit.
 *
 * Idempotent: if HEAD already equals `baseCommit` (e.g. after a prior squash)
 * this is a no-op and returns false.
 *
 * @returns true if commits were collapsed, false if it was a no-op.
 */
export function collapseTaskCommits(
  git: Git,
  baseCommit: string | undefined,
  worktreePath: string
): boolean {
  if (!baseCommit) return false;

  const head = git.getCommitHash('HEAD', { worktreePath });
  if (!head || head === baseCommit) return false;

  git.resetSoft(baseCommit, { worktreePath });
  return true;
}
